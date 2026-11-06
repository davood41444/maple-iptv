/*
 * Full-screen playback of a movie or episode: progress bar and seeking,
 * resume where you left off, audio / subtitle choice, and the next episode.
 * params: { kind: 'movie' | 'episode', title, item, url (movie),
 *           queue + index (episodes), startMs, back (details params), backTo? }
 */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;
  const OSD_MS = 4000;
  const SAVE_EVERY_MS = 10000;
  const NEXT_COUNTDOWN = 10;
  const SEEK_RAMP_AFTER = 1.5; // seconds of holding before seeking speeds up
  const SEEK_DOUBLE_EVERY = 0.8; // then the speed doubles this often (seconds)

  function languageName(code) {
    if (!code || code === 'und') return '';
    try {
      return new Intl.DisplayNames([App.i18n.lang], { type: 'language' }).of(code) || code;
    } catch (e) {
      return code.toUpperCase();
    }
  }

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] || m;
    });
  }

  // Samsung's player hands over subtitle lines as they are in the file, markup included:
  // SRT/SAMI tags (<br>, <i>, <font color=…>), ASS codes ({\an8}, {\i1}, \N) and entities.
  // Line breaks and italics are kept; everything else is dropped. Built as DOM nodes, never
  // as HTML, since the text comes from the stream.
  function showSubtitle(el, raw) {
    el.textContent = '';
    const text = String(raw || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\\[Nn]/g, '\n')
      .replace(/\\h/g, ' ')
      .replace(/<br\s*\/?\s*>|<br\s*\/?(?=\s|$)/gi, '\n')
      .replace(/\{\\i1\}/gi, '<i>')
      .replace(/\{\\i0?\}/gi, '</i>')
      .replace(/\{\\[^}]*\}/g, '')
      .split('\n')
      .map(line => line.replace(/[ \t]+/g, ' ').trim())
      .filter(line => line.replace(/<\/?[a-z][^>]*>/gi, '').trim())
      .join('\n');
    let italic = false;
    text.split(/(<\/?[a-z][^>]*>)/i).forEach(part => {
      const tag = /^<(\/)?\s*([a-z]+)/i.exec(part);
      if (tag) {
        if (/^(i|em)$/i.test(tag[2])) italic = !tag[1];
        return;
      }
      if (!part) return;
      const node = document.createTextNode(decodeEntities(part));
      if (italic) el.appendChild(h('i')).appendChild(node);
      else el.appendChild(node);
    });
    return el.textContent.trim() !== '';
  }

  App.router.register({
    name: 'vodPlayer',
    videoMode: true,

    build() {
      this.titleEl = h('div', { class: 'vod-title' });
      this.subEl = h('div', { class: 'vod-sub' });
      this.fill = h('div', { class: 'vod-fill' });
      this.marker = h('div', { class: 'vod-marker' });
      this.elapsed = h('span');
      this.total = h('span');

      // Control buttons, reached with Down while the bar is showing.
      const button = (key, icon, label, onclick) => h('button', {
        class: 'btn osd-btn focusable', 'data-key': key, onclick: onclick,
        html: App.icons[icon] + '<span>' + App.esc(label) + '</span>',
      });
      this.btnPrev = button('prev', 'prev', t('player.prevEpisode'), () => this.playPrevious());
      this.btnPlay = button('play', 'pause', t('player.pause'), () => {
        App.player.togglePause();
        this.showOsd(true);
      });
      this.btnNext = button('next', 'next', t('player.nextEpisode'), () => this.playNext());
      this.btnTracks = button('tracks', 'subtitles', t('player.tracks'), () => this.chooseTracks());
      let buttons = [this.btnPrev, this.btnPlay, this.btnNext, this.btnTracks];
      // Windows/Mac: 10-second jumps around Play, and the volume and full screen on the right.
      if (App.desktop) {
        const d = App.desktop;
        buttons = [
          this.btnPrev,
          d.button('rewind', t('player.rewind'), () => this.seek(-1, false)),
          this.btnPlay,
          d.button('forward', t('player.forward'), () => this.seek(1, false)),
          this.btnNext,
          this.btnTracks,
          h('div', { class: 'mc-spacer' }),
          d.volumeControl(),
          d.button('fullscreen', t('player.fullscreen'), d.toggleFullScreen),
        ];
      }

      this.osd = h('div', { class: 'vod-osd' }, [
        this.titleEl,
        this.subEl,
        h('div', { class: 'vod-bar' }, [this.fill, this.marker]),
        h('div', { class: 'vod-times' }, [this.elapsed, this.total]),
        h('div', { class: 'vod-buttons' }, buttons),
        h('div', { class: 'vod-hints', html: [
          '<span class="key">◄ ►</span>' + t('player.hintSeek'),
          '<span class="key">OK</span>' + t('player.hintPause'),
          '<span class="key">▼</span>' + t('player.hintOptions'),
        ].map(s => '<span>' + s + '</span>').join('') }),
      ]);
      this.status = h('div', { class: 'osd-status hidden' });
      this.subtitle = h('div', { class: 'vod-subtitle hidden' });
      this.nextCard = h('div', { class: 'next-card hidden', onclick: () => this.playNext() });
      [this.osd, this.status, this.subtitle, this.nextCard].forEach(el => this.el.appendChild(el));

      // Touch and mouse: tap or drag along the bar to jump there, tap the picture for
      // the controls, double-tap its left or right half to go back or forward 10 seconds
      // (on a computer, a double-click is full screen instead).
      const bar = this.osd.querySelector('.vod-bar');
      const barTarget = e => {
        const r = bar.getBoundingClientRect();
        return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * App.player.duration;
      };
      bar.addEventListener('pointerdown', e => {
        if (!(App.player.duration > 0)) return;
        bar.setPointerCapture(e.pointerId);
        clearTimeout(this.seekTimer);
        this.dragging = true;
        this.seekTarget = barTarget(e);
        this.renderTime(App.player.position, App.player.duration);
        this.showOsd(true);
      });
      bar.addEventListener('pointermove', e => {
        if (!this.dragging) return;
        this.seekTarget = barTarget(e);
        this.renderTime(App.player.position, App.player.duration);
      });
      bar.addEventListener('pointerup', () => {
        if (!this.dragging) return;
        this.dragging = false;
        App.player.seekTo(this.seekTarget);
        this.seekTarget = null;
        this.showOsd();
      });
      let lastTap = 0;
      App.gestures(this.el, {
        ignore: target => !!target.closest('button, .vod-bar, .next-card, .mc-volume'),
        tap: e => {
          const now = Date.now();
          if (App.touch && now - lastTap < 350) {
            this.seek(e.clientX < window.innerWidth / 2 ? -1 : 1, false);
            lastTap = 0;
            return;
          }
          lastTap = now;
          if (this.osd.classList.contains('show')) this.osd.classList.remove('show');
          else this.showOsd();
        },
      });

      App.player.on((state, data) => {
        if (App.router.current === this) this.onPlayer(state, data);
      });
    },

    show(params) {
      this.params = params;
      this.index = params.index || 0;
      this.start(params.startMs || 0);
    },

    hide() {
      this.saveProgress();
      clearTimeout(this.osdTimer);
      clearTimeout(this.seekTimer);
      clearTimeout(this.subtitleTimer);
      this.cancelNext();
      App.player.stop();
    },

    episode() {
      return this.params.queue ? this.params.queue[this.index] : null;
    },

    start(startMs) {
      const ep = this.episode();
      this.cancelNext();
      this.seekTarget = null;
      this.lastSave = Date.now();
      this.titleEl.textContent = this.params.title;
      this.subEl.textContent = ep ? t('player.episodeLabel', { s: App.fmtNum(ep.season), e: App.fmtNum(ep.num) }) + (ep.title ? '  ·  ' + ep.title : '') : '';
      this.renderTime(startMs, -1);
      const queue = this.params.queue;
      this.btnPrev.classList.toggle('hidden', !queue);
      this.btnNext.classList.toggle('hidden', !queue);
      this.btnPrev.disabled = !queue || this.index === 0;
      this.btnNext.disabled = !queue || this.index >= queue.length - 1;
      App.player.play({
        kind: ep ? 'episode' : 'movie',
        url: ep ? App.vod.episodeUrl(ep) : this.params.url,
      }, { startMs: startMs });
      if (startMs > 0) App.ui.toast(t('player.resumed', { time: App.fmtClock(startMs / 1000) }));
      this.showOsd();
    },

    progressId() {
      const ep = this.episode();
      return ep ? ep.id : this.params.item.id;
    },

    saveProgress(finished) {
      const pos = App.player.position;
      const dur = App.player.duration;
      if (!App.player.isVod() || !(dur > 0) || (!finished && pos < 5000)) return;
      const sourceId = App.state.source.id;
      const done = finished || pos / dur > 0.95;
      App.progress.set(sourceId, this.progressId(), { pos: done ? 0 : pos, dur: dur, done: done });
      const ep = this.episode();
      if (ep) App.progress.set(sourceId, this.params.item.id, { episodeId: ep.id });
      this.lastSave = Date.now();
    },

    renderTime(position, duration) {
      const shown = this.seekTarget != null ? this.seekTarget : position;
      const percent = duration > 0 ? Math.min(100, shown / duration * 100) : 0;
      this.fill.style.width = percent + '%';
      this.marker.style.left = percent + '%';
      this.elapsed.textContent = App.fmtClock(shown / 1000);
      this.total.textContent = duration > 0 ? App.fmtClock(duration / 1000) : '';
    },

    // Mouse movement shows the controls; they stay while the pointer is on them.
    onPointerMove(e) {
      this.showOsd(!!e.target.closest('.vod-osd'));
    },

    showOsd(sticky) {
      this.osd.classList.add('show');
      clearTimeout(this.osdTimer);
      if (sticky || App.player.state !== 'playing') return;
      this.osdTimer = setTimeout(() => {
        this.osd.classList.remove('show');
        if (this.osd.contains(App.focus.current)) App.focus.set(null);
      }, OSD_MS);
    },

    // Down while watching: show the bar and put focus on its buttons.
    focusButtons() {
      this.showOsd(true);
      App.focus.set([this.btnNext, this.btnPlay].find(b => !b.disabled && !b.classList.contains('hidden')));
    },

    updatePlayButton(state) {
      const paused = state === 'paused';
      this.btnPlay.innerHTML = App.icons[paused ? 'play' : 'pause'] + '<span>' + App.esc(t(paused ? 'player.play' : 'player.pause')) + '</span>';
    },

    setStatus(html, kind) {
      this.status.className = 'osd-status ' + (kind || '') + (html ? '' : ' hidden');
      this.status.innerHTML = html || '';
    },

    onPlayer(state, data) {
      if (state === 'playing' || state === 'paused') this.updatePlayButton(state);
      switch (state) {
        case 'time':
          this.renderTime(data.position, data.duration);
          if (Date.now() - this.lastSave > SAVE_EVERY_MS) this.saveProgress();
          break;
        case 'buffering':
          this.setStatus('<div class="spinner"></div>');
          break;
        case 'playing':
          this.setStatus(null);
          this.showOsd();
          break;
        case 'paused':
          this.setStatus('<div class="osd-pause"></div><div>' + t('player.paused') + '</div>');
          this.showOsd(true);
          this.saveProgress();
          break;
        case 'retrying':
          this.setStatus('<div class="spinner"></div><div>' + t('player.retrying', { n: App.fmtNum(data.attempt), max: App.fmtNum(data.max) }) + '</div>');
          break;
        case 'error':
          this.setStatus('<div class="osd-error-title">' + t('player.vodError') + '</div><div class="osd-error-hint">' +
            t('player.errorHint') + '</div>' + (data.message ? '<div class="osd-error-code">' + App.esc(data.message) + '</div>' : ''), 'error');
          this.showOsd(true);
          break;
        case 'ended':
          this.saveProgress(true);
          if (this.params.queue && this.index < this.params.queue.length - 1) this.offerNext();
          else this.exit();
          break;
        case 'notice':
          App.ui.toast(t(data.key), 'error');
          break;
        case 'subtitle':
          this.subtitle.classList.toggle('hidden', !showSubtitle(this.subtitle, data.text));
          clearTimeout(this.subtitleTimer);
          this.subtitleTimer = setTimeout(() => this.subtitle.classList.add('hidden'), data.duration || 3000);
          break;
      }
    },

    // ---- Next episode ----

    offerNext() {
      const next = this.params.queue[this.index + 1];
      let left = NEXT_COUNTDOWN;
      const render = () => {
        this.nextCard.innerHTML = '<div class="next-label">' + t('player.nextEpisode') + '</div>' +
          '<div class="next-title">' + App.esc(t('player.episodeLabel', { s: App.fmtNum(next.season), e: App.fmtNum(next.num) }) + (next.title ? '  ·  ' + next.title : '')) + '</div>' +
          '<div class="next-count">' + t('player.nextIn', { n: App.fmtNum(left) }) + '</div>';
      };
      render();
      this.nextCard.classList.remove('hidden');
      this.nextTimer = setInterval(() => {
        left--;
        if (left <= 0) this.playNext();
        else render();
      }, 1000);
    },

    cancelNext() {
      clearInterval(this.nextTimer);
      this.nextTimer = null;
      this.nextCard.classList.add('hidden');
    },

    playNext() {
      if (!this.params.queue || this.index >= this.params.queue.length - 1) return;
      this.saveProgress();
      this.index++;
      this.start(0);
    },

    playPrevious() {
      if (!this.params.queue || this.index === 0) return;
      this.saveProgress();
      this.index--;
      this.start(0);
    },

    // ---- Seeking: presses add up, the jump happens once the remote is still ----

    // A press jumps 10 seconds. Holding the key runs through the film, gently
    // at first and then faster the longer it's held (long films go faster).
    seek(direction, repeat) {
      if (!App.player.isVod() || !(App.player.duration > 0)) return;
      const duration = App.player.duration;
      const now = Date.now();
      let step = 10000;
      if (repeat && this.hold && this.hold.direction === direction) {
        const held = (now - this.hold.start) / 1000;
        const slow = Math.max(20000, duration / 300);
        const fast = Math.max(slow, duration / 8);
        const speed = held < SEEK_RAMP_AFTER ? slow : Math.min(fast, slow * Math.pow(2, (held - SEEK_RAMP_AFTER) / SEEK_DOUBLE_EVERY));
        step = speed * Math.min(250, now - this.hold.last) / 1000;
        this.hold.last = now;
      } else {
        this.hold = { direction: direction, start: now, last: now };
      }
      const base = this.seekTarget != null ? this.seekTarget : App.player.position;
      this.seekTarget = Math.max(0, Math.min(duration - 1000, base + direction * step));
      this.renderTime(App.player.position, App.player.duration);
      this.showOsd(true);
      clearTimeout(this.seekTimer);
      this.seekTimer = setTimeout(() => {
        App.player.seekTo(this.seekTarget);
        this.seekTarget = null;
        this.showOsd();
      }, 700);
    },

    // ---- Audio and subtitles ----

    async chooseTracks() {
      const tracks = App.player.tracks;
      const options = [];
      let current = null;
      tracks.audio.forEach((tr, i) => {
        const name = tr.label || languageName(tr.language) || t('player.track', { n: App.fmtNum(i + 1) });
        const channels = tr.channels > 2 ? '  ·  ' + (tr.channels === 6 ? '5.1' : tr.channels === 8 ? '7.1' : tr.channels + 'ch') : '';
        options.push({ value: 'audio|' + tr.id, label: t('player.audio') + ': ' + name + channels });
        if (tr.selected) current = 'audio|' + tr.id;
      });
      tracks.text.forEach((tr, i) => {
        const name = tr.label || languageName(tr.language) || t('player.track', { n: App.fmtNum(i + 1) });
        options.push({ value: 'text|' + tr.id, label: t('player.subtitles') + ': ' + name });
        if (tr.selected) current = 'text|' + tr.id;
      });
      if (tracks.text.length) options.push({ value: 'text|off', label: t('player.subtitles') + ': ' + t('subs.off') });
      if (tracks.audio.length < 2 && !tracks.text.length) {
        App.ui.toast(t('player.noTracks'));
        return;
      }
      const choice = await App.ui.choose(t('player.tracks'), options, current);
      if (!choice) return;
      const parts = choice.split('|');
      App.player.selectTrack(parts[0], parts[1]);
      if (parts[0] === 'text' && parts[1] === 'off') this.subtitle.classList.add('hidden');
    },

    // Back to the title's page, or to params.backTo (the Downloads screen).
    exit() {
      App.router.go(this.params.backTo || 'details', this.params.back);
    },

    onKey(name, ctx) {
      const playing = App.player.state;
      if (this.nextTimer) {
        if (name === 'Enter') this.playNext();
        else if (name === 'Back') this.exit();
        else return true;
        return true;
      }
      // On the control buttons: arrows move between them and OK presses one; Up or Back leaves them.
      if (this.osd.contains(App.focus.current)) {
        if (name === 'Up' || name === 'Back') {
          App.focus.set(null);
          this.showOsd();
          return true;
        }
        this.showOsd(true);
        if (name === 'Left' || name === 'Right' || name === 'Enter') return false;
        if (name === 'Down') return true;
      }
      switch (name) {
        case 'Left':
        case 'Right':
          this.seek(name === 'Right' ? 1 : -1, ctx.repeat);
          break;
        case 'Enter':
          if (playing === 'error') App.player.retry();
          else App.player.togglePause();
          this.showOsd();
          break;
        case 'PlayPause':
        case 'Play':
        case 'Pause':
          App.player.togglePause();
          this.showOsd();
          break;
        case 'Up':
        case 'Menu':
          this.chooseTracks();
          break;
        case 'Down':
          this.focusButtons();
          break;
        case 'Info':
          if (this.osd.classList.contains('show')) this.osd.classList.remove('show');
          else this.showOsd();
          break;
        case 'ChannelUp':
        case 'PageUp':
          this.playNext();
          break;
        case 'ChannelDown':
        case 'PageDown':
          this.playPrevious();
          break;
        case 'Back':
        case 'Stop':
          this.exit();
          break;
      }
      return true;
    },
  });
})();
