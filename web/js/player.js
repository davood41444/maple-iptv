/*
 * Video playback. The UI talks to App.player; underneath, each platform uses
 * its best player: ExoPlayer on Android (via the AndroidHost bridge), AVPlay
 * on Samsung Tizen, and hls.js / mpegts.js in a desktop browser for testing.
 *
 * Listeners get (state, data) with state one of: buffering, playing, paused,
 * retrying ({ attempt, max }), error ({ message }), ended, idle, plus
 * 'video' ({ width, height }), 'time' ({ position, duration } in ms),
 * 'tracks' ({ audio, text }: [{ id, language, label, channels, selected }]),
 * 'subtitle' ({ text, duration }) where the page draws subtitles itself,
 * and 'notice' ({ key }: a locale key worth telling the viewer).
 */
(function () {
  'use strict';
  const App = window.App;
  const MAX_RETRIES = 3;
  // A stream that stays "loading" this long is treated as dropped and reconnected.
  const STALL_MS = 20000;
  const SUB_SIZES = { s: 0.8, m: 1, l: 1.3, xl: 1.65 };
  const SUB_COLORS = { white: '#ffffff', yellow: '#ffe14d', cyan: '#6be3f2', green: '#8cff8c' };
  App.subtitleOptions = {
    subSize: Object.keys(SUB_SIZES),
    subColor: Object.keys(SUB_COLORS),
    subBackground: ['shadow', 'box', 'black'],
    subFont: ['default', 'bold', 'vazirmatn'],
  };
  // The Windows/Mac app ships its own copies (desktop/vendor).
  const HLS_JS = App.platform === 'desktop' ? 'vendor/hls.min.js' : 'https://cdn.jsdelivr.net/npm/hls.js@1.7.2/dist/hls.min.js';
  const MPEGTS_JS = App.platform === 'desktop' ? 'vendor/mpegts.min.js' : 'https://cdn.jsdelivr.net/npm/mpegts.js@1.8.2/dist/mpegts.min.js';

  const adapters = {};

  // ---- Android: ExoPlayer in MainActivity, drawn underneath the transparent WebView ----
  adapters.android = {
    init(emit) {
      this.emit = emit;
      this.state = 'idle';
      this.playing = false;
      App.native.onPlayer = e => this.onNative(e);
    },
    // ExoPlayer reports playback state and is-playing separately; combine them.
    onNative(e) {
      switch (e.event) {
        case 'state':
          this.state = e.value;
          if (e.value === 'buffering' || e.value === 'ended') this.emit(e.value);
          else if (e.value === 'ready' && this.playing) this.emit('playing');
          break;
        case 'playing':
          this.playing = e.value;
          if (e.value) this.emit('playing');
          else if (this.state === 'ready') this.emit('paused');
          break;
        case 'video':
          this.emit('video', { width: e.width, height: e.height });
          break;
        case 'time':
          this.emit('time', { position: e.position, duration: e.duration });
          break;
        case 'tracks':
          this.emit('tracks', { audio: e.audio, text: e.text });
          break;
        case 'error':
          this.emit('error', { message: e.message });
          break;
      }
    },
    play(url, headers, startMs) {
      this.state = 'idle';
      this.playing = false;
      window.AndroidHost.play(url, JSON.stringify(headers), startMs || 0);
    },
    stop() { window.AndroidHost.stop(); },
    pause() { window.AndroidHost.pause(); },
    resume() { window.AndroidHost.resume(); },
    seekTo(ms) { window.AndroidHost.seekTo(ms); },
    selectTrack(type, id) { window.AndroidHost.selectTrack(type, id); },
    setSubtitleLanguage(language) { window.AndroidHost.setSubtitleLanguage(language); },
    setSubtitleStyle(style) { window.AndroidHost.setSubtitleStyle(JSON.stringify(style)); },
    setAspect(mode) { window.AndroidHost.setResizeMode(mode); },
    // The WebView covers the screen, so page pixels × devicePixelRatio are screen pixels.
    setVideoRect(el) {
      if (!el) {
        window.AndroidHost.setVideoRect(0, 0, 0, 0);
        return;
      }
      const r = el.getBoundingClientRect();
      const d = window.devicePixelRatio || 1;
      window.AndroidHost.setVideoRect(Math.round(r.left * d), Math.round(r.top * d), Math.round(r.width * d), Math.round(r.height * d));
    },
  };

  // Tizen and the browser draw subtitles in the page (.vod-subtitle), styled through CSS variables.
  function cssSubtitleStyle(style) {
    const root = document.documentElement.style;
    root.setProperty('--sub-size', (46 * style.size) + 'px');
    root.setProperty('--sub-color', style.color);
    root.setProperty('--sub-bg', style.background === 'black' ? '#000' : (style.background === 'box' ? 'rgba(0, 0, 0, 0.6)' : 'transparent'));
    root.setProperty('--sub-shadow', style.background === 'shadow' ? '0 2px 6px #000, 0 0 3px #000' : 'none');
    root.setProperty('--sub-font', style.font === 'vazirmatn' ? 'Vazirmatn' : 'inherit');
    root.setProperty('--sub-weight', style.font === 'bold' ? '800' : '600');
  }

  // ---- Samsung Tizen: AVPlay renders on the video plane behind the page ----
  const TIZEN_DISPLAY = {
    fit: 'PLAYER_DISPLAY_MODE_LETTER_BOX',
    fill: 'PLAYER_DISPLAY_MODE_FULL_SCREEN',
    zoom: 'PLAYER_DISPLAY_MODE_FULL_SCREEN',
  };

  function tizenScreenSaver(on) {
    try {
      const state = webapis.appcommon.AppCommonScreenSaverState;
      webapis.appcommon.setScreenSaver(on ? state.SCREEN_SAVER_ON : state.SCREEN_SAVER_OFF);
    } catch (e) { /* not critical */ }
  }

  adapters.tizen = {
    init(emit) {
      this.emit = emit;
      const surface = document.createElement('object');
      surface.type = 'application/avplayer';
      surface.className = 'video-surface';
      document.getElementById('video-layer').appendChild(surface);
      // Drop the stream in the background; App.player.retry() reconnects (movies at their position).
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && App.player.channel) {
          this.close();
          this.suspended = true;
        } else if (!document.hidden && this.suspended) {
          this.suspended = false;
          App.player.retry();
        }
      });
    },
    play(url, headers, startMs) {
      const av = webapis.avplay;
      this.close();
      try {
        av.open(url);
        if (headers['User-Agent']) {
          try { av.setStreamingProperty('USER_AGENT', headers['User-Agent']); } catch (e) { /* older firmware */ }
        }
        this.applyRect();
        av.setListener({
          onbufferingstart: () => this.emit('buffering'),
          onbufferingcomplete: () => this.emit('playing'),
          onstreamcompleted: () => this.emit('ended'),
          oncurrentplaytime: ms => this.emit('time', { position: ms, duration: this.duration() }),
          onsubtitlechange: (duration, text) => this.emit('subtitle', { text: text, duration: Number(duration) }),
          onerror: type => this.emit('error', { message: String(type) }),
        });
        av.prepareAsync(() => {
          const begin = () => {
            av.play();
            this.emit('playing');
            this.reportStreams();
          };
          if (startMs > 0) av.seekTo(startMs, begin, begin);
          else begin();
        }, err => this.emit('error', { message: err && err.name }));
      } catch (e) {
        this.emit('error', { message: e.message });
      }
      tizenScreenSaver(false);
    },
    duration() {
      try { return webapis.avplay.getDuration() || -1; } catch (e) { return -1; }
    },
    reportStreams() {
      try {
        const audio = [];
        const text = [];
        webapis.avplay.getTotalTrackInfo().forEach(track => {
          let extra = {};
          try { extra = JSON.parse(track.extra_info); } catch (e) { /* no details */ }
          const entry = { id: String(track.index), language: extra.language || extra.track_lang || '', label: '', channels: Number(extra.channels) || 0, selected: false };
          if (track.type === 'VIDEO') this.emit('video', { width: Number(extra.Width), height: Number(extra.Height) });
          else if (track.type === 'AUDIO') audio.push(entry);
          else if (track.type === 'TEXT') text.push(entry);
        });
        this.emit('tracks', { audio: audio, text: text });
      } catch (e) { /* unknown streams */ }
    },
    close() {
      try { webapis.avplay.stop(); } catch (e) { /* not open */ }
      try { webapis.avplay.close(); } catch (e) { /* not open */ }
    },
    stop() {
      this.close();
      tizenScreenSaver(true);
    },
    pause() {
      try {
        webapis.avplay.pause();
        this.emit('paused');
      } catch (e) { /* not playing */ }
    },
    resume() {
      try {
        webapis.avplay.play();
        this.emit('playing');
      } catch (e) { /* not paused */ }
    },
    seekTo(ms) {
      try { webapis.avplay.seekTo(Math.max(0, ms)); } catch (e) { /* not seekable */ }
    },
    selectTrack(type, id) {
      try {
        if (type === 'text' && id === 'off') {
          webapis.avplay.setSilentSubtitle(true);
          return;
        }
        webapis.avplay.setSelectTrack(type === 'audio' ? 'AUDIO' : 'TEXT', Number(id));
        if (type === 'text') webapis.avplay.setSilentSubtitle(false);
      } catch (e) { /* track not available */ }
    },
    setSubtitleLanguage() { /* chosen from the track menu on Tizen */ },
    setSubtitleStyle: cssSubtitleStyle,
    // AVPlay places video in 1920x1080 screen coordinates.
    setVideoRect(el) {
      this.rect = el;
      this.applyRect();
    },
    applyRect() {
      try {
        if (!this.rect) {
          webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
          return;
        }
        const r = this.rect.getBoundingClientRect();
        const f = 1920 / document.documentElement.clientWidth;
        webapis.avplay.setDisplayRect(Math.round(r.left * f), Math.round(r.top * f), Math.round(r.width * f), Math.round(r.height * f));
      } catch (e) { /* nothing open yet */ }
    },
    setAspect(mode) {
      try { webapis.avplay.setDisplayMethod(TIZEN_DISPLAY[mode] || TIZEN_DISPLAY.fit); } catch (e) { /* not open yet */ }
    },
  };

  // ---- Desktop browser and the Windows/Mac app: <video> with hls.js / mpegts.js through /proxy ----
  // Addresses on the page's own server (downloaded files) need no proxy.
  const proxied = url => (url.charAt(0) === '/' ? url : '/proxy?url=' + encodeURIComponent(url));

  // Track languages arrive as ISO 639-2 codes (per, ger…), BCP 47 tags (fa-IR) or names:
  // two-letter codes where there is one, so they match the settings and get display names.
  const LANG_3 = {
    per: 'fa', fas: 'fa', prs: 'fa', eng: 'en', ara: 'ar', tur: 'tr', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de',
    spa: 'es', ita: 'it', por: 'pt', rus: 'ru', chi: 'zh', zho: 'zh', jpn: 'ja', kor: 'ko', hin: 'hi', urd: 'ur',
    heb: 'he', dut: 'nl', nld: 'nl', pol: 'pl', swe: 'sv', nor: 'no', dan: 'da', fin: 'fi', hun: 'hu', gre: 'el',
    ell: 'el', cze: 'cs', ces: 'cs', rum: 'ro', ron: 'ro', ukr: 'uk', vie: 'vi', tha: 'th', ind: 'id', may: 'ms',
    msa: 'ms', kur: 'ku', aze: 'az', pus: 'ps', arm: 'hy', hye: 'hy', geo: 'ka', kat: 'ka', alb: 'sq', sqi: 'sq',
  };
  function trackLanguage(language, label) {
    const code = String(language || '').toLowerCase().split(/[-_]/)[0];
    if (code.length === 2) return code;
    if (LANG_3[code]) return LANG_3[code];
    if (/persian|farsi|فارسی|پارسی/i.test(label || '')) return 'fa';
    if (/english|انگلیسی/i.test(label || '')) return 'en';
    return code === 'und' || code === 'mis' || code === 'zxx' ? '' : code;
  }

  // Many files leave a subtitle track's language unset: guess it from its text
  // (Persian and Arabic share a script; پ چ ژ گ and Persian ی/ک are Persian only).
  function textLanguage(texts) {
    const sample = texts.join(' ');
    if (/[پچژگیک]/.test(sample)) return 'fa';
    if (/[؀-ۿ]/.test(sample)) return 'ar';
    return '';
  }

  // Sound formats Chromium may not decode (AC-3, DTS… on most computers): asked of the
  // engine itself, so a build that can play them is not warned about.
  const AUDIO_TYPES = {
    A_AAC: 'audio/mp4; codecs="mp4a.40.2"', mp4a: 'audio/mp4; codecs="mp4a.40.2"',
    A_AC3: 'audio/mp4; codecs="ac-3"', 'ac-3': 'audio/mp4; codecs="ac-3"',
    A_EAC3: 'audio/mp4; codecs="ec-3"', 'ec-3': 'audio/mp4; codecs="ec-3"',
    A_DTS: 'audio/mp4; codecs="dtsc"', dtsc: 'audio/mp4; codecs="dtsc"', dtsh: 'audio/mp4; codecs="dtsh"', dtsl: 'audio/mp4; codecs="dtsl"',
    A_TRUEHD: 'audio/mp4; codecs="mlpa"', mlpa: 'audio/mp4; codecs="mlpa"',
    A_OPUS: 'audio/webm; codecs="opus"', Opus: 'audio/webm; codecs="opus"',
    A_VORBIS: 'audio/webm; codecs="vorbis"', A_FLAC: 'audio/flac', fLaC: 'audio/flac', A_MPEG: 'audio/mpeg', '.mp3': 'audio/mpeg',
  };
  function canPlayAudio(video, codec) {
    const key = Object.keys(AUDIO_TYPES).find(k => codec === k || String(codec).indexOf(k + '/') === 0);
    return !key || video.canPlayType(AUDIO_TYPES[key]) !== '';
  }

  adapters.browser = {
    init(emit) {
      this.emit = emit;
      const v = this.video = document.createElement('video');
      v.className = 'video-surface';
      v.autoplay = true;
      document.getElementById('video-layer').appendChild(v);
      const when = fn => () => { if (this.active) fn(); };
      v.addEventListener('waiting', when(() => emit('buffering')));
      v.addEventListener('playing', when(() => emit('playing')));
      v.addEventListener('pause', when(() => { if (!v.ended) emit('paused'); }));
      v.addEventListener('ended', when(() => emit('ended')));
      v.addEventListener('error', when(() => emit('error', { message: v.error ? 'MEDIA_ERR_' + v.error.code : 'error' })));
      v.addEventListener('resize', when(() => emit('video', { width: v.videoWidth, height: v.videoHeight })));
      v.addEventListener('loadedmetadata', when(() => {
        if (this.startAt) v.currentTime = this.startAt / 1000;
        this.startAt = 0;
      }));
      v.addEventListener('timeupdate', when(() => emit('time', {
        position: v.currentTime * 1000,
        duration: isFinite(v.duration) ? v.duration * 1000 : -1,
      })));
      // A movie's audio tracks (the Windows/Mac app turns on Chromium's AudioVideoTracks).
      if (v.audioTracks) ['addtrack', 'removetrack', 'change'].forEach(name => v.audioTracks.addEventListener(name, when(() => this.reportTracks())));
      this.subtitleLanguage = 'fa';
    },
    play(url, headers, startMs) {
      // A reconnect to the same title keeps the subtitle chosen from the menu.
      const kept = this.subs && this.subs.key === url && this.subs.manual ? this.subs.chosen : undefined;
      this.stop();
      this.keptSubtitle = kept;
      this.active = true;
      this.startAt = startMs || 0;
      const v = this.video;
      const token = this.token = {};
      const fail = e => this.emit('error', { message: e.message });
      if (/m3u8/i.test(url)) {
        this.watchSubtitles(url, false);
        App.loadScript(HLS_JS).then(() => {
          if (this.token !== token) return;
          this.startHls(url, -1, null);
        }, fail);
      } else if (/\.(mp4|m4v|webm|mov|mkv)(\?|$)/i.test(url)) {
        // Movie files: the local server reads their subtitles as they download.
        this.watchSubtitles(url, true);
        v.src = proxied(url);
      } else {
        App.loadScript(MPEGTS_JS).then(() => {
          if (this.token !== token) return;
          const mpegts = window.mpegts;
          this.mpegts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: location.origin + proxied(url) });
          this.mpegts.on(mpegts.Events.ERROR, (type, detail) => this.emit('error', { message: type + ': ' + detail }));
          this.mpegts.attachMediaElement(v);
          this.mpegts.load();
          this.mpegts.play();
        }, fail);
      }
    },
    stop() {
      this.active = false;
      this.token = null;
      this.audioSwitch = null;
      this.stopSubtitles();
      if (this.hls) { this.hls.destroy(); this.hls = null; }
      if (this.mpegts) { this.mpegts.destroy(); this.mpegts = null; }
      this.video.removeAttribute('src');
      this.video.load();
    },
    pause() { this.video.pause(); },
    resume() { this.video.play().catch(() => {}); },
    seekTo(ms) { this.video.currentTime = Math.max(0, ms / 1000); },
    setVolume(volume) { this.video.volume = volume; },

    // startSec: where to begin (-1: hls.js decides); audio: { lang, name } of the audio track to use.
    startHls(url, startSec, audio) {
      const hls = this.hls = new window.Hls({
        // Subtitles and captions come to us as cues (CUES_PARSED) and are drawn by the page.
        enableWebVTT: true,
        enableCEA708Captions: true,
        renderTextTracksNatively: false,
        startPosition: startSec,
        audioPreference: audio || undefined,
        xhrSetup: (xhr, u) => {
          xhr.open('GET', proxied(u), true);
          // hls.js resolves relative segment paths against responseURL; keep it the real address.
          Object.defineProperty(xhr, 'responseURL', { value: u });
        },
      });
      this.hlsUrl = url;
      this.watchHls(hls);
      let recoveredAt = 0;
      hls.on(window.Hls.Events.ERROR, (e, data) => {
        if (this.hls !== hls) return;
        // Right after an audio switch hls.js couldn't do in place: restart with that language.
        const sw = this.audioSwitch;
        if (sw && Date.now() - sw.at < 8000 && (data.fatal || /mediaSourceRequiresReset|bufferAppendError/.test(data.details))) {
          this.audioSwitch = null;
          this.restartHls(sw.audio);
          return;
        }
        if (!data.fatal) return;
        // A media error is often fixed by hls.js rebuilding its buffers in place; a repeat
        // soon after counts as a playback problem (and reconnects).
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && Date.now() - recoveredAt > 10000) {
          recoveredAt = Date.now();
          hls.recoverMediaError();
          return;
        }
        this.emit('error', { message: data.details });
      });
      hls.loadSource(url);
      hls.attachMedia(this.video);
    },

    // Another audio language of an HLS stream: in place (the usual layout, each language its
    // own playlist); if hls.js can't (audio packed with the video), the error handler above
    // restarts the stream where it was with that language preferred.
    switchHlsAudio(index) {
      const track = this.hls.audioTracks[index];
      if (!track || index === this.hls.audioTrack) return;
      this.audioSwitch = { at: Date.now(), audio: { lang: track.lang, name: track.name } };
      this.hls.audioTrack = index;
    },

    restartHls(audio) {
      const at = this.video.currentTime;
      const paused = this.video.paused;
      this.hls.destroy();
      this.startHls(this.hlsUrl, at, audio);
      if (paused) this.video.addEventListener('canplay', () => this.video.pause(), { once: true });
    },

    // ---- Subtitles and audio tracks ----
    // this.subs: { key, text: [track], audio: [info], cues: Map(track → Map(key → cue)),
    //              chosen: track id or null, manual, shown }
    watchSubtitles(key, fromServer) {
      const s = this.subs = { key: key, since: 0, text: [], audio: [], cues: new Map(), sorted: new Map(), chosen: null, manual: false, shown: '', warned: false };
      if (this.keptSubtitle !== undefined) {
        s.manual = true;
        s.chosen = this.keptSubtitle;
        s.hlsTrack = s.chosen && s.chosen.indexOf('hls') === 0 ? Number(s.chosen.slice(3)) : -1;
        this.keptSubtitle = undefined;
      }
      // Movie files: ask the local server what it has read so far, every second.
      const poll = () => {
        if (this.subs !== s) return;
        fetch('/subtitles?key=' + encodeURIComponent(key) + '&since=' + s.since).then(r => r.json()).then(data => {
          if (this.subs !== s) return;
          data.cues.forEach(c => this.addCue(c[1], c[2], c[3], c[4]));
          s.since = data.last;
          const info = JSON.stringify([data.text, data.audio]);
          if (info !== s.info) {
            s.info = info;
            s.text = data.text.map(t => ({ id: t.id, language: trackLanguage(t.language, t.label), label: t.label, default: t.default, forced: t.forced }));
            s.audio = data.audio;
            this.checkAudio();
          }
          // Tracks without a language: guessed from their first lines once those arrive.
          let guessed = false;
          s.text.forEach(t => {
            if (t.language || t.guessed || !s.cues.has(t.id)) return;
            const lines = Array.from(s.cues.get(t.id).values()).slice(0, 20).map(c => c.text);
            if (lines.length < 3 && data.cues.length) return; // wait for a few lines
            t.guessed = true;
            t.language = textLanguage(lines);
            guessed = guessed || !!t.language;
          });
          if (info !== s.lastPicked || guessed) {
            s.lastPicked = info;
            this.pickSubtitle();
            this.reportTracks();
          }
        }).catch(() => { /* the page's own server only: nothing to do in a plain browser */ }).then(() => {
          if (this.subs === s) s.poll = setTimeout(poll, 1000);
        });
      };
      if (fromServer) poll();
      s.tick = setInterval(() => this.showCue(), 200);
    },

    stopSubtitles() {
      const s = this.subs;
      if (!s) return;
      clearTimeout(s.poll);
      clearInterval(s.tick);
      this.subs = null;
      if (s.shown) this.emit('subtitle', { text: '', duration: 0 });
    },

    addCue(track, start, end, text) {
      const s = this.subs;
      if (!s || !text) return;
      if (!s.cues.has(track)) s.cues.set(track, new Map());
      s.cues.get(track).set(start + '|' + text, { start: start, end: end, text: text });
      s.sorted.delete(track);
    },

    // Every 200 ms: the chosen track's cues showing now, as one subtitle.
    showCue() {
      const s = this.subs;
      if (!s || !this.active) return;
      const t = this.video.currentTime * 1000;
      let list = [];
      if (s.chosen && s.cues.has(s.chosen)) {
        list = s.sorted.get(s.chosen);
        if (!list) s.sorted.set(s.chosen, list = Array.from(s.cues.get(s.chosen).values()).sort((a, b) => a.start - b.start));
      }
      const now = list.filter(c => c.start <= t && t < c.end);
      const text = now.map(c => c.text).join('\n');
      if (text === s.shown) return;
      s.shown = text;
      // This tick takes the subtitle down itself (also when paused or seeking within it),
      // so the screen's own time limit is set out of the way.
      this.emit('subtitle', { text: text, duration: 24 * 3600 * 1000 });
    },

    // Follows the subtitles setting (fa / en / off) until a track is chosen from the menu.
    // With no track in that language, a default track whose language isn't set (common in
    // files from IPTV providers) is shown rather than nothing.
    pickSubtitle() {
      const s = this.subs;
      if (!s || s.manual) return;
      const want = this.subtitleLanguage;
      if (want === 'off') return this.useSubtitle(null);
      const matching = s.text.filter(t => t.language === want);
      const unknown = s.text.filter(t => !t.language && !t.forced);
      const track = matching.find(t => t.default && !t.forced) || matching.find(t => !t.forced) || matching[0] ||
        unknown.find(t => t.default) || (s.text.length === 1 ? unknown[0] : null);
      this.useSubtitle(track ? track.id : null);
    },

    useSubtitle(id) {
      const s = this.subs;
      if (!s) return;
      s.chosen = id;
      s.shown = null; // redraw on the next tick
      // HLS loads only the chosen subtitle track (captions come with the video).
      s.hlsTrack = id && id.indexOf('hls') === 0 ? Number(id.slice(3)) : -1;
      this.applyHlsSubtitle();
    },

    // hls.js picks its own subtitle track after loading the playlist: keep ours.
    applyHlsSubtitle() {
      const s = this.subs;
      if (!this.hls || !s || s.hlsTrack == null) return;
      if (this.hls.subtitleTrack !== s.hlsTrack) this.hls.subtitleTrack = s.hlsTrack;
      this.hls.subtitleDisplay = s.hlsTrack >= 0;
    },

    // Every audio track in a format this computer can't play: say so once, rather than play silently.
    checkAudio() {
      const s = this.subs;
      if (!s || s.warned || !s.audio.length) return;
      if (s.audio.some(a => canPlayAudio(this.video, a.codec))) return;
      s.warned = true;
      this.emit('notice', { key: 'player.audioUnsupported' });
    },

    reportTracks() {
      const s = this.subs;
      const v = this.video;
      const audio = [];
      if (this.hls && this.hls.audioTracks && this.hls.audioTracks.length > 1) {
        this.hls.audioTracks.forEach((a, i) => audio.push({
          id: String(i), language: trackLanguage(a.lang, a.name), label: a.name || '',
          channels: parseInt(a.channels, 10) || 0, selected: i === this.hls.audioTrack,
        }));
      } else if (v.audioTracks) {
        const info = s && s.audio.length === v.audioTracks.length ? s.audio : [];
        for (let i = 0; i < v.audioTracks.length; i++) {
          const a = v.audioTracks[i];
          audio.push({
            id: String(i), language: trackLanguage(a.language || (info[i] && info[i].language), a.label),
            label: a.label || (info[i] && info[i].label) || '', channels: info[i] ? info[i].channels : 0, selected: a.enabled,
          });
        }
      }
      const text = (s ? s.text : []).map(t => ({ id: t.id, language: t.language, label: t.label, channels: 0, selected: t.id === s.chosen }));
      this.emit('tracks', { audio: audio, text: text });
    },

    // HLS: subtitle renditions, closed captions (CEA-608/708) and alternate audio, from hls.js.
    watchHls(hls) {
      const E = window.Hls.Events;
      const s = this.subs;
      const update = () => {
        if (this.subs !== s) return;
        this.pickSubtitle();
        this.reportTracks();
      };
      hls.on(E.SUBTITLE_TRACKS_UPDATED, (e, data) => {
        const captions = s.text.filter(t => t.id.indexOf('cc:') === 0);
        s.text = data.subtitleTracks.map((t, i) => ({ id: 'hls' + i, language: trackLanguage(t.lang, t.name), label: t.name || '', default: !!t.default, forced: !!t.forced })).concat(captions);
        update();
      });
      hls.on(E.NON_NATIVE_TEXT_TRACKS_FOUND, (e, data) => {
        data.tracks.filter(t => t.kind === 'captions').forEach(t => {
          const id = 'cc:' + (t.closedCaptions && t.closedCaptions.instreamId ? t.closedCaptions.instreamId : t.label);
          if (!s.text.some(x => x.id === id)) s.text.push({ id: id, language: trackLanguage(t.closedCaptions && t.closedCaptions.lang, t.label), label: t.label || 'CC', default: false, forced: false });
        });
        update();
      });
      hls.on(E.CUES_PARSED, (e, data) => {
        let track;
        if (data.type === 'captions') {
          const caption = s.text.find(t => t.id.indexOf('cc:') === 0 && (t.id === 'cc:' + data.track || t.label === data.track));
          track = caption ? caption.id : 'cc:' + data.track;
        } else {
          const index = data.subtitleTrack ? hls.subtitleTracks.indexOf(data.subtitleTrack) : hls.subtitleTrack;
          track = 'hls' + (index >= 0 ? index : hls.subtitleTrack);
        }
        data.cues.forEach(c => this.addCue(track, c.startTime * 1000, c.endTime * 1000, c.text));
      });
      const keep = () => setTimeout(() => { if (this.subs === s) this.applyHlsSubtitle(); }, 0);
      hls.on(E.MANIFEST_PARSED, keep);
      hls.on(E.SUBTITLE_TRACK_SWITCH, keep);
      hls.on(E.AUDIO_TRACKS_UPDATED, () => this.reportTracks());
      hls.on(E.AUDIO_TRACK_SWITCHED, () => this.reportTracks());
    },

    selectTrack(type, id) {
      if (type === 'audio') {
        if (this.hls && this.hls.audioTracks && this.hls.audioTracks.length > 1) {
          this.switchHlsAudio(Number(id));
        } else if (this.video.audioTracks) {
          for (let i = 0; i < this.video.audioTracks.length; i++) this.video.audioTracks[i].enabled = String(i) === id;
        }
      } else if (this.subs) {
        this.subs.manual = true;
        this.useSubtitle(id === 'off' ? null : id);
      }
      this.reportTracks();
    },
    setSubtitleLanguage(language) {
      this.subtitleLanguage = language;
      this.pickSubtitle();
    },
    setSubtitleStyle: cssSubtitleStyle,
    // The <video> lives on the scaled stage, so convert to stage pixels.
    setVideoRect(el) {
      const style = this.video.style;
      if (!el) {
        style.left = style.top = '0';
        style.width = style.height = '100%';
        return;
      }
      const stageEl = document.getElementById('stage');
      const stage = stageEl.getBoundingClientRect();
      const scale = stage.width / stageEl.offsetWidth;
      const r = el.getBoundingClientRect();
      style.left = (r.left - stage.left) / scale + 'px';
      style.top = (r.top - stage.top) / scale + 'px';
      style.width = r.width / scale + 'px';
      style.height = r.height / scale + 'px';
    },
    setAspect(mode) { this.video.style.objectFit = mode === 'fill' ? 'fill' : (mode === 'zoom' ? 'cover' : 'contain'); },
  };

  // The Windows/Mac app plays like a browser, its proxy being desktop/server.js.
  adapters.desktop = adapters.browser;

  // ---- Common front end ----

  let retryTimer = null;
  let stallTimer = null;
  const listeners = [];
  const volumeListeners = [];

  const player = App.player = {
    channel: null,
    state: 'idle',
    retries: 0,
    position: 0,
    duration: -1,
    tracks: { audio: [], text: [] },

    init() {
      this.impl = adapters[App.platform];
      this.impl.init(onAdapterEvent);
      this.impl.setSubtitleLanguage(App.settings.get('subtitles'));
      this.applySubtitleStyle();
      this.volume = App.settings.get('volume');
      this.muted = App.settings.get('muted');
      this.applyVolume();
    },

    // Volume 0–1 and mute: only where the app plays sound itself (computers);
    // TVs and phones use their own volume. onVolume(fn) hears the changes.
    setVolume(volume) {
      this.volume = Math.round(Math.max(0, Math.min(1, volume)) * 100) / 100;
      this.muted = false;
      App.settings.set('volume', this.volume);
      App.settings.set('muted', false);
      this.applyVolume();
    },

    toggleMute() {
      this.muted = !this.muted;
      App.settings.set('muted', this.muted);
      this.applyVolume();
    },

    applyVolume() {
      if (this.impl.setVolume) this.impl.setVolume(this.muted ? 0 : this.volume);
      volumeListeners.forEach(fn => fn(this.volume, this.muted));
    },

    onVolume(fn) {
      volumeListeners.push(fn);
    },

    // From the settings: subSize, subColor, subBackground, subFont.
    applySubtitleStyle() {
      this.impl.setSubtitleStyle({
        size: SUB_SIZES[App.settings.get('subSize')] || 1,
        color: SUB_COLORS[App.settings.get('subColor')] || '#ffffff',
        background: App.settings.get('subBackground'),
        font: App.settings.get('subFont'),
      });
    },

    on(fn) {
      listeners.push(fn);
    },

    // item: { url, ua?, referrer?, kind: 'live' | 'movie' | 'episode' }
    play(item, opts) {
      this.channel = item;
      this.retries = 0;
      this.position = (opts && opts.startMs) || 0;
      this.duration = -1;
      this.videoSize = null;
      this.tracks = { audio: [], text: [] };
      start();
    },

    isVod() {
      return !!this.channel && !!this.channel.kind && this.channel.kind !== 'live';
    },

    retry() {
      if (!this.channel) return;
      this.retries = 0;
      start();
    },

    stop() {
      clearTimeout(retryTimer);
      if (this.channel) this.impl.stop();
      this.channel = null;
      setState('idle');
    },

    togglePause() {
      if (this.state === 'playing') this.impl.pause();
      else if (this.state === 'paused') this.impl.resume();
    },

    seekTo(ms) {
      if (!this.isVod()) return;
      const end = this.duration > 0 ? this.duration - 1000 : ms;
      this.position = Math.max(0, Math.min(ms, end));
      this.impl.seekTo(this.position);
      if (this.state === 'paused') this.impl.resume();
    },

    selectTrack(type, id) {
      this.impl.selectTrack(type, id);
    },

    setSubtitleLanguage(language) {
      this.impl.setSubtitleLanguage(language);
    },

    setAspect(mode) {
      this.impl.setAspect(mode);
    },

    // Show the video inside an element (the channel-list preview), or full screen for null.
    setVideoRect(el) {
      this.impl.setVideoRect(el || null);
    },

    // Already showing this stream (e.g. going from the preview to full screen)?
    isPlaying(item) {
      return !!this.channel && !!item && this.channel.url === item.url && this.state !== 'error' && this.state !== 'idle';
    },
  };

  function start() {
    clearTimeout(retryTimer);
    const channel = player.channel;
    const headers = {};
    if (channel.ua) headers['User-Agent'] = channel.ua;
    if (channel.referrer) headers.Referer = channel.referrer;
    setState('buffering');
    // Movies reconnect where they were; live streams at the live edge.
    player.impl.play(channel.url, headers, player.isVod() ? player.position : 0);
    player.impl.setAspect(App.settings.get('aspect'));
  }

  function setState(state, data) {
    player.state = state;
    clearTimeout(stallTimer);
    if (state === 'buffering' && player.channel) {
      stallTimer = setTimeout(() => onAdapterEvent('error', { message: 'Stalled' }), STALL_MS);
    }
    listeners.forEach(fn => fn(state, data || {}));
  }

  function notify(type, data) {
    listeners.forEach(fn => fn(type, data));
  }

  function onAdapterEvent(type, data) {
    if (!player.channel) return;
    switch (type) {
      case 'video':
        player.videoSize = data;
        notify(type, data);
        return;
      case 'subtitle':
      case 'notice':
        notify(type, data);
        return;
      case 'time':
        player.position = data.position;
        player.duration = data.duration;
        notify(type, data);
        return;
      case 'tracks':
        player.tracks = data;
        notify(type, data);
        return;
    }
    if (type === 'ended' && player.isVod()) {
      setState('ended');
      return;
    }
    if (type === 'error' || type === 'ended') {
      // Streams drop now and then: reconnect a few times before giving up.
      console.warn('Playback problem', type, data);
      if (player.retries < MAX_RETRIES) {
        player.retries++;
        setState('retrying', { attempt: player.retries, max: MAX_RETRIES });
        retryTimer = setTimeout(start, 1500 * player.retries);
      } else {
        setState('error', data);
      }
      return;
    }
    if (type === 'playing') player.retries = 0;
    setState(type, data);
  }
})();
