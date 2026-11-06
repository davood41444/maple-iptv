/*
 * Remote-control navigation: a virtual focus (the .focused class) that moves
 * between .focusable elements by screen position, a virtualised list for long
 * channel lists, and the screen router.
 */
(function () {
  'use strict';
  const App = window.App;

  function isVisible(el) {
    if (el.disabled) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Distance between two ranges on one axis; 0 when they overlap.
  function rangeGap(a1, a2, b1, b2) {
    if (b2 < a1) return a1 - b2;
    if (b1 > a2) return b1 - a2;
    return 0;
  }

  function nearest(from, dir, candidates) {
    const a = from.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    const horizontal = dir === 'Left' || dir === 'Right';
    const rtl = App.i18n.isRtl();
    let best = null;
    let bestScore = Infinity;
    candidates.forEach(el => {
      if (el === from || el.contains(from) || from.contains(el)) return;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      let gap;
      let cross;
      // Only elements that start past the middle of the current one count as
      // being in that direction (neighbours in the same row differ in height
      // by fractions of a pixel and must not count as "below").
      if (horizontal) {
        if (dir === 'Right' ? b.left < ax : b.right > ax) return;
        gap = dir === 'Right' ? b.left - a.right : a.left - b.right;
        cross = rangeGap(a.top, a.bottom, b.top, b.bottom);
      } else {
        if (dir === 'Down' ? b.top < ay : b.bottom > ay) return;
        gap = dir === 'Down' ? b.top - a.bottom : a.top - b.bottom;
        cross = rangeGap(a.left, a.right, b.left, b.right);
      }
      // Prefer elements in line with the current one, then the closest, then
      // the one whose leading edge lines up (so Down from a wide field lands
      // on the first button of the row below).
      const align = horizontal ? Math.abs(b.top - a.top) : (rtl ? Math.abs(b.right - a.right) : Math.abs(b.left - a.left));
      const score = Math.max(gap, 0) + cross * 4 + align * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    });
    return best;
  }

  // Keep the focused element inside its scrolling containers (.scroller) in view,
  // vertically and sideways (e.g. a row of posters inside a scrolling page).
  function reveal(el) {
    for (let scroller = el.closest('.scroller'); scroller; scroller = scroller.parentElement && scroller.parentElement.closest('.scroller')) {
      const box = scroller.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const scale = box.height / scroller.offsetHeight || 1;
      const margin = 24 * scale;
      if (r.top < box.top + margin) scroller.scrollTop -= (box.top + margin - r.top) / scale;
      else if (r.bottom > box.bottom - margin) scroller.scrollTop += (r.bottom - box.bottom + margin) / scale;
      if (r.left < box.left + margin) scroller.scrollLeft -= (box.left + margin - r.left) / scale;
      else if (r.right > box.right - margin) scroller.scrollLeft += (r.right - box.right + margin) / scale;
    }
  }

  const focus = App.focus = {
    current: null,

    set(el) {
      if (focus.current === el) return;
      if (focus.current) focus.current.classList.remove('focused');
      focus.current = el || null;
      if (el) {
        el.classList.add('focused');
        reveal(el);
      }
    },

    move(dir, scope) {
      const candidates = Array.prototype.filter.call(scope.querySelectorAll('.focusable'), isVisible);
      const from = focus.current;
      if (!from || !scope.contains(from) || !isVisible(from)) {
        focus.set(candidates[0] || null);
        return !!candidates[0];
      }
      const next = nearest(from, dir, candidates);
      if (next) focus.set(next);
      return !!next;
    },
  };

  /*
   * Touch and mouse for VirtualList / VirtualGrid: drag to scroll (with a
   * little momentum), tap a row or card to select it, hold it for its options
   * (lists with onLongPress), mouse wheel to scroll. Rows and cards carry their
   * index in data-i.
   */
  function dragScroll(list) {
    const el = list.el;
    let pointer = null;
    let startY = 0;
    let startTop = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let dragging = false;
    let held = false;
    let holdTimer = 0;
    let frame = 0;
    const rowPx = () => list.opts.rowHeight * (App.stageScale || 1);

    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      cancelAnimationFrame(frame);
      pointer = e.pointerId;
      startY = lastY = e.clientY;
      startTop = list.top;
      lastTime = e.timeStamp;
      velocity = 0;
      dragging = false;
      held = false;
      clearTimeout(holdTimer);
      const target = e.target.closest('[data-i]');
      if (list.opts.onLongPress && target) {
        holdTimer = setTimeout(() => {
          held = true;
          list.hold(Number(target.dataset.i));
        }, HOLD_MS);
      }
    });
    el.addEventListener('pointermove', e => {
      if (e.pointerId !== pointer) return;
      const dy = e.clientY - startY;
      if (!dragging && Math.abs(dy) > 12) {
        dragging = true;
        clearTimeout(holdTimer);
        el.classList.add('dragging');
        try { el.setPointerCapture(pointer); } catch (err) { /* already released */ }
      }
      if (!dragging) return;
      velocity = (e.clientY - lastY) / Math.max(1, e.timeStamp - lastTime);
      lastY = e.clientY;
      lastTime = e.timeStamp;
      list.scrollTo(startTop - dy / rowPx());
    });
    el.addEventListener('pointerup', e => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      clearTimeout(holdTimer);
      if (held) return;
      if (!dragging) {
        const target = e.target.closest('[data-i]');
        if (target && el.contains(target)) list.tap(Number(target.dataset.i), e.target);
        return;
      }
      el.classList.remove('dragging');
      let v = velocity;
      const glide = () => {
        if (Math.abs(v) < 0.02) return;
        list.scrollTo(list.top - v * 16 / rowPx());
        v *= 0.94;
        frame = requestAnimationFrame(glide);
      };
      frame = requestAnimationFrame(glide);
    });
    el.addEventListener('pointercancel', e => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      clearTimeout(holdTimer);
      el.classList.remove('dragging');
    });
    // A long touch would otherwise also open the browser's own menu.
    if (list.opts.onLongPress) el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => {
      e.preventDefault();
      list.scrollTo(list.top + e.deltaY / (rowPx() * 1.5));
    }, { passive: false });
  }

  /**
   * A list that only renders the rows on screen, so playlists with tens of
   * thousands of channels stay fast. The list is one focusable element; Up and
   * Down move its highlighted row. With columns: 2 each row also has an action
   * cell (the favourite star), reached with the forward arrow.
   *
   * opts: rowHeight, renderRow(item, index) -> html, onSelect(item, index, column),
   *       onChange(item, index), columns, className, onRender() after rows are drawn
   */
  // A name too long for its row scrolls back and forth while the row is highlighted
  // (the CSS only runs it in a focused list).
  function marquee(el) {
    if (!el || el.classList.contains('marquee') || el.scrollWidth <= el.clientWidth + 1) return;
    const shift = el.scrollWidth - el.clientWidth;
    el.style.setProperty('--marquee-shift', (getComputedStyle(el).direction === 'rtl' ? shift : -shift) + 'px');
    el.style.setProperty('--marquee-time', (2 + shift / 70).toFixed(1) + 's');
    el.classList.add('marquee');
  }

  function VirtualList(opts) {
    this.opts = opts;
    this.items = [];
    this.index = 0;
    this.column = 0;
    this.top = 0;
    this.rows = new Map();
    this.inner = App.h('div', { class: 'vlist-inner' });
    this.emptyEl = App.h('div', { class: 'vlist-empty' });
    this.el = App.h('div', { class: 'vlist focusable ' + (opts.className || '') }, [this.inner, this.emptyEl]);
    this.el._onKey = this.onKey.bind(this);
    dragScroll(this);
  }

  VirtualList.prototype = {
    setItems(items, index, emptyHtml) {
      this.items = items || [];
      this.column = 0;
      this.clearRows();
      this.emptyEl.innerHTML = this.items.length ? '' : (emptyHtml || '');
      this.emptyEl.style.display = this.items.length ? 'none' : '';
      this.top = 0;
      this.index = -1;
      this.select(index || 0, true);
    },

    current() {
      return this.items[this.index];
    },

    visibleCount() {
      return Math.max(1, Math.floor(this.el.clientHeight / this.opts.rowHeight));
    },

    select(i, silent) {
      const n = this.visibleCount();
      i = Math.max(0, Math.min(i, this.items.length - 1));
      const changed = i !== this.index;
      this.index = i;
      const margin = Math.min(2, Math.floor((n - 1) / 2));
      if (i < this.top + margin) this.top = i - margin;
      if (i > this.top + n - 1 - margin) this.top = i - n + 1 + margin;
      this.top = Math.max(0, Math.min(this.top, this.items.length - n));
      this.render();
      if (changed && !silent && this.opts.onChange && this.items.length) this.opts.onChange(this.items[i], i);
    },

    render() {
      const h = this.opts.rowHeight;
      const start = Math.max(0, Math.floor(this.top) - 2);
      const end = Math.min(this.items.length, Math.ceil(this.top) + this.visibleCount() + 2);
      this.rows.forEach((row, i) => {
        if (i < start || i >= end) {
          row.remove();
          this.rows.delete(i);
        }
      });
      for (let i = start; i < end; i++) {
        let row = this.rows.get(i);
        if (!row) {
          row = document.createElement('div');
          row.className = 'vrow';
          row.dataset.i = i;
          row.style.top = (i * h) + 'px';
          row.style.height = h + 'px';
          row.innerHTML = this.opts.renderRow(this.items[i], i);
          this.inner.appendChild(row);
          this.rows.set(i, row);
        }
        row.classList.toggle('active', i === this.index);
        row.classList.toggle('col1', i === this.index && this.column === 1);
        if (this.opts.isPlaying) row.classList.toggle('playing', this.opts.isPlaying(this.items[i]));
      }
      this.inner.style.transform = 'translateY(' + (-this.top * h) + 'px)';
      const active = this.rows.get(this.index);
      if (active) marquee(active.querySelector('.g-name, .ch-name'));
      if (this.opts.onRender) this.opts.onRender();
    },

    refreshRow(i) {
      const row = this.rows.get(i);
      if (!row) return;
      row.innerHTML = this.opts.renderRow(this.items[i], i);
      if (i === this.index) marquee(row.querySelector('.g-name, .ch-name'));
    },

    // Touch scrolling: top may be fractional.
    scrollTo(top) {
      this.top = Math.max(0, Math.min(top, this.items.length - this.visibleCount()));
      this.render();
    },

    // A tap selects the row and presses it (the star when the tap was on it).
    tap(i, target) {
      const item = this.items[i];
      if (!item) return;
      App.focus.set(this.el);
      const changed = i !== this.index;
      this.index = i;
      this.column = this.opts.columns === 2 && target.closest('.ch-fav, .row-action') ? 1 : 0;
      this.render();
      if (changed && this.opts.onChange) this.opts.onChange(item, i);
      this.opts.onSelect(item, i, this.column);
      this.column = 0;
      this.render();
    },

    // Re-render everything, e.g. once the list becomes visible and has a height.
    refresh() {
      this.clearRows();
      this.select(this.index, true);
    },

    clearRows() {
      this.rows.forEach(row => row.remove());
      this.rows.clear();
    },

    onKey(name) {
      const page = this.visibleCount() - 1;
      switch (name) {
        case 'Up':
          if (this.index <= 0) return false;
          this.select(this.index - 1);
          return true;
        case 'Down':
          if (this.index >= this.items.length - 1) return false;
          this.select(this.index + 1);
          return true;
        case 'PageUp':
        case 'ChannelUp':
          this.select(this.index - page);
          return true;
        case 'PageDown':
        case 'ChannelDown':
          this.select(this.index + page);
          return true;
        case 'Enter':
          if (this.current()) this.opts.onSelect(this.current(), this.index, this.column);
          return true;
      }
      if (this.opts.columns === 2 && this.items.length) {
        if (name === App.i18n.forwardKey() && this.column === 0) {
          this.column = 1;
          this.render();
          return true;
        }
        if (name === App.i18n.backwardKey() && this.column === 1) {
          this.column = 0;
          this.render();
          return true;
        }
      }
      return false;
    },
  };

  App.VirtualList = VirtualList;

  const HOLD_MS = 550;

  /**
   * Like VirtualList, but a grid of cards (movie posters). Only the rows on
   * screen are rendered. Arrow keys move between cards; moving out of the
   * grid's edge returns false so focus can go to the neighbouring panel.
   *
   * opts: columns, rowHeight, gap, renderCell(item, index) -> html,
   *       onSelect(item, index), onChange(item, index), className,
   *       aspect + rowExtra: rows as tall as a card's width × aspect, plus rowExtra,
   *       onLongPress(item, index): holding OK (or a finger) on a card
   */
  function VirtualGrid(opts) {
    this.opts = opts;
    this.items = [];
    this.index = 0;
    this.top = 0;
    this.cells = new Map();
    this.inner = App.h('div', { class: 'vgrid-inner' });
    this.emptyEl = App.h('div', { class: 'vlist-empty' });
    this.el = App.h('div', { class: 'vgrid focusable ' + (opts.className || '') }, [this.inner, this.emptyEl]);
    this.el._onKey = this.onKey.bind(this);
    dragScroll(this);
  }

  VirtualGrid.prototype = {
    setItems(items, index, emptyHtml) {
      this.items = items || [];
      clearTimeout(this.holdTimer);
      this.pressed = null;
      this.clearCells();
      this.emptyEl.innerHTML = this.items.length ? '' : (emptyHtml || '');
      this.emptyEl.style.display = this.items.length ? 'none' : '';
      this.top = 0;
      this.index = -1;
      this.select(index || 0, true);
    },

    current() {
      return this.items[this.index];
    },

    visibleRows() {
      return Math.max(1, Math.floor(this.el.clientHeight / this.opts.rowHeight));
    },

    select(i, silent) {
      const cols = this.opts.columns;
      i = Math.max(0, Math.min(i, this.items.length - 1));
      const changed = i !== this.index;
      this.index = i;
      const row = Math.floor(i / cols);
      const rows = this.visibleRows();
      if (row < this.top) this.top = row;
      if (row > this.top + rows - 1) this.top = row - rows + 1;
      this.render();
      if (changed && !silent && this.opts.onChange && this.items.length) this.opts.onChange(this.items[i], i);
    },

    render() {
      const cols = this.opts.columns;
      const gap = this.opts.gap || 0;
      const width = this.inner.clientWidth;
      const cellWidth = (width - gap * (cols - 1)) / cols;
      if (this.opts.aspect && width > 0) {
        const rowHeight = Math.round(cellWidth * this.opts.aspect) + (this.opts.rowExtra || 0);
        if (rowHeight !== this.opts.rowHeight) {
          this.opts.rowHeight = rowHeight;
          this.clearCells();
        }
      }
      const h = this.opts.rowHeight;
      const rtl = App.i18n.isRtl();
      const start = Math.max(0, (Math.floor(this.top) - 1) * cols);
      const end = Math.min(this.items.length, (Math.ceil(this.top) + this.visibleRows() + 1) * cols);
      this.cells.forEach((cell, i) => {
        if (i < start || i >= end) {
          cell.remove();
          this.cells.delete(i);
        }
      });
      for (let i = start; i < end; i++) {
        let cell = this.cells.get(i);
        if (!cell) {
          const x = (i % cols) * (cellWidth + gap);
          cell = document.createElement('div');
          cell.className = 'vcell';
          cell.dataset.i = i;
          cell.style.top = (Math.floor(i / cols) * h) + 'px';
          cell.style.left = (rtl ? width - x - cellWidth : x) + 'px';
          cell.style.width = cellWidth + 'px';
          cell.style.height = h + 'px';
          cell.innerHTML = this.opts.renderCell(this.items[i], i);
          this.inner.appendChild(cell);
          this.cells.set(i, cell);
        }
        cell.classList.toggle('active', i === this.index);
      }
      this.inner.style.transform = 'translateY(' + (-this.top * h) + 'px)';
    },

    refreshCell(i) {
      const cell = this.cells.get(i);
      if (cell) cell.innerHTML = this.opts.renderCell(this.items[i], i);
    },

    scrollTo(top) {
      const rows = Math.ceil(this.items.length / this.opts.columns);
      this.top = Math.max(0, Math.min(top, rows - this.visibleRows()));
      this.render();
    },

    tap(i) {
      const item = this.items[i];
      if (!item) return;
      App.focus.set(this.el);
      const changed = i !== this.index;
      this.index = i;
      this.render();
      if (changed && this.opts.onChange) this.opts.onChange(item, i);
      this.opts.onSelect(item, i);
    },

    // A finger held on card i (see dragScroll).
    hold(i) {
      if (!this.items[i] || !this.opts.onLongPress) return;
      App.focus.set(this.el);
      if (i !== this.index) {
        this.index = i;
        this.render();
        if (this.opts.onChange) this.opts.onChange(this.items[i], i);
      }
      this.opts.onLongPress(this.items[i], i);
    },

    // OK went down on a card: a short press opens it when the key comes back up,
    // holding it opens the card's options instead.
    pressStart() {
      clearTimeout(this.holdTimer);
      this.pressed = this.index;
      this.holdTimer = setTimeout(() => {
        const i = this.pressed;
        this.pressed = null;
        if (this.items[i]) this.opts.onLongPress(this.items[i], i);
      }, HOLD_MS);
    },

    pressEnd() {
      if (this.pressed == null) return false;
      clearTimeout(this.holdTimer);
      const i = this.pressed;
      this.pressed = null;
      if (this.items[i]) this.opts.onSelect(this.items[i], i);
      return true;
    },

    refresh() {
      this.clearCells();
      this.select(this.index, true);
    },

    clearCells() {
      this.cells.forEach(cell => cell.remove());
      this.cells.clear();
    },

    onKey(name) {
      const cols = this.opts.columns;
      const col = this.index % cols;
      const n = this.items.length;
      switch (name) {
        case 'Up':
          if (this.index < cols) return false;
          this.select(this.index - cols);
          return true;
        case 'Down':
          if (Math.floor(this.index / cols) >= Math.floor((n - 1) / cols)) return false;
          this.select(Math.min(this.index + cols, n - 1));
          return true;
        case 'PageUp':
        case 'ChannelUp':
          this.select(this.index - cols * this.visibleRows());
          return true;
        case 'PageDown':
        case 'ChannelDown':
          this.select(this.index + cols * this.visibleRows());
          return true;
        case 'Enter':
          if (!this.current()) return true;
          if (this.opts.onLongPress) this.pressStart();
          else this.opts.onSelect(this.current(), this.index);
          return true;
        case 'EnterUp':
          return this.pressEnd();
      }
      if (name === App.i18n.forwardKey()) {
        if (col === cols - 1 || this.index >= n - 1) return false;
        this.select(this.index + 1);
        return true;
      }
      if (name === App.i18n.backwardKey()) {
        if (col === 0) return false;
        this.select(this.index - 1);
        return true;
      }
      return false;
    },
  };

  App.VirtualGrid = VirtualGrid;

  /*
   * Taps and swipes on a full-screen element (the players).
   * handlers: { tap(event), swipe('Up'|'Down'|'Left'|'Right'), ignore(target) }
   */
  App.gestures = function (el, handlers) {
    let pointer = null;
    let x0 = 0;
    let y0 = 0;
    el.addEventListener('pointerdown', e => {
      if (handlers.ignore && handlers.ignore(e.target)) return;
      pointer = e.pointerId;
      x0 = e.clientX;
      y0 = e.clientY;
    });
    el.addEventListener('pointerup', e => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) {
        if (handlers.tap) handlers.tap(e);
      } else if (handlers.swipe) {
        handlers.swipe(Math.abs(dy) > Math.abs(dx) ? (dy < 0 ? 'Up' : 'Down') : (dx < 0 ? 'Left' : 'Right'));
      }
    });
    el.addEventListener('pointercancel', () => { pointer = null; });
  };

  /*
   * Screens are objects { name, build(), show(params), hide(), onKey(name) }
   * registered with App.router. Each gets a <section> element (screen.el),
   * built the first time it is shown.
   */
  App.router = {
    screens: {},
    current: null,
    params: {},
    overlays: [],

    register(screen) {
      this.screens[screen.name] = screen;
    },

    go(name, params) {
      const next = this.screens[name];
      const prev = this.current;
      if (prev && prev !== next) {
        if (prev.hide) prev.hide();
        prev.el.classList.remove('active');
      }
      if (!next.el) {
        next.el = App.h('section', { class: 'screen screen-' + name });
        document.getElementById('screens').appendChild(next.el);
        if (next.build) next.build();
      }
      this.current = next;
      this.params = params || {};
      document.documentElement.dataset.screen = next.name;
      document.documentElement.classList.toggle('video-mode', !!next.videoMode);
      // holeMode: the page is see-through only where the screen leaves a window for the video.
      document.documentElement.classList.toggle('hole-mode', !!next.holeMode);
      next.el.classList.add('active');
      focus.set(null);
      if (next.show) next.show(this.params);
      App.events.emit('screen', next.name);
    },

    // Throw away every screen's DOM (after a language change) and re-show the current one.
    rebuildAll(params) {
      const current = this.current;
      Object.keys(this.screens).forEach(key => {
        const screen = this.screens[key];
        if (screen.el) {
          screen.el.remove();
          screen.el = null;
        }
      });
      this.current = null;
      if (current) this.go(current.name, params || this.params);
    },

    pushOverlay(overlay) {
      this.overlays.push(overlay);
    },

    popOverlay(overlay) {
      const i = this.overlays.indexOf(overlay);
      if (i >= 0) this.overlays.splice(i, 1);
    },

    topOverlay() {
      return this.overlays[this.overlays.length - 1] || null;
    },

    // The element arrow-key navigation is confined to.
    scope() {
      const overlay = this.topOverlay();
      return overlay ? overlay.el : this.current.el;
    },
  };
})();
