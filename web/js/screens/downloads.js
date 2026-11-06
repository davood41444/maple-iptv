/*
 * Downloads (Windows/Mac app, see js/downloads.js): every downloaded or waiting
 * movie and episode with its progress, and play / pause / resume / delete.
 * Finished ones play from the file, even without internet.
 */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;

  App.router.register({
    name: 'downloads',

    build() {
      this.el.appendChild(App.ui.header(t('downloads.title'), [
        App.ui.iconButton('folder', t('downloads.openFolder'), () => App.downloads.show()),
        App.ui.iconButton('settings', t('downloads.changeFolder'), () => App.downloads.chooseFolder()),
      ]));
      this.folderEl = h('div', { class: 'dl-folder' });
      this.list = h('div', { class: 'dl-list' });
      this.empty = h('div', { class: 'dl-empty', text: t('downloads.empty') });
      this.el.appendChild(h('div', { class: 'dl-body scroller' }, [this.folderEl, this.list, this.empty]));
      this.rows = new Map();
      App.events.on('downloads', () => {
        if (App.router.current === this) this.update();
      });
    },

    show() {
      this.update();
      App.focus.set(this.list.querySelector('.focusable'));
    },

    update() {
      const state = App.downloads.state;
      this.folderEl.textContent = t('downloads.folder', { folder: state.folder });
      // Newest first; a series' episodes stay together, in order.
      const groupTime = new Map();
      state.items.forEach(d => {
        const key = d.seriesId ? d.sourceId + d.seriesId : d.id;
        groupTime.set(key, Math.max(groupTime.get(key) || 0, d.addedAt));
      });
      const time = d => groupTime.get(d.seriesId ? d.sourceId + d.seriesId : d.id);
      const items = state.items.slice().sort((a, b) => time(b) - time(a) ||
        (a.episode && b.episode ? a.episode.season - b.episode.season || a.episode.num - b.episode.num : b.addedAt - a.addedAt));
      const ids = new Set(items.map(d => d.id));
      this.rows.forEach((row, id) => {
        if (ids.has(id)) return;
        if (row.contains(App.focus.current)) App.focus.set(null);
        row.remove();
        this.rows.delete(id);
      });
      items.forEach((d, i) => {
        let row = this.rows.get(d.id);
        if (!row) {
          row = this.row(d);
          this.rows.set(d.id, row);
        }
        if (this.list.children[i] !== row) this.list.insertBefore(row, this.list.children[i] || null);
        this.updateRow(row, d);
      });
      this.empty.classList.toggle('hidden', items.length > 0);
      if (!App.focus.current || !document.body.contains(App.focus.current)) App.focus.set(this.list.querySelector('.focusable'));
    },

    row(d) {
      const ep = d.episode;
      const sub = ep ? t('player.episodeLabel', { s: App.fmtNum(ep.season), e: App.fmtNum(ep.num) }) + (ep.title ? '  ·  ' + ep.title : '') : (d.year || '');
      const row = h('div', { class: 'dl-row' }, [
        h('span', { class: 'dl-thumb', html: '<span class="poster-fallback">' + App.esc(d.title) + '</span>' +
          (d.poster ? '<img src="' + App.esc(d.poster) + '" alt="" onerror="this.remove()">' : '') }),
        h('div', { class: 'dl-text' }, [
          h('div', { class: 'dl-title', text: d.title }),
          h('div', { class: 'dl-sub', text: sub }),
          h('div', { class: 'dl-bar' }, [h('i')]),
          h('div', { class: 'dl-status' }),
        ]),
        h('div', { class: 'dl-actions' }),
      ]);
      return row;
    },

    updateRow(row, d) {
      const done = d.status === 'done';
      row.classList.toggle('done', done);
      row.querySelector('.dl-bar').classList.toggle('hidden', done);
      row.querySelector('.dl-bar i').style.width = App.downloads.percent(d) + '%';
      const sizes = d.size ? App.fmtBytes(d.received) + ' / ' + App.fmtBytes(d.size) : (d.received ? App.fmtBytes(d.received) : '');
      const parts = [App.downloads.statusText(d)];
      if (done && d.size) parts.push(App.fmtBytes(d.size));
      if (d.status === 'downloading' && sizes) parts.push(sizes);
      if (d.status === 'downloading' && d.speed) parts.push(App.fmtBytes(d.speed) + '/s');
      row.querySelector('.dl-status').textContent = parts.join('  ·  ');
      // Buttons change only with the status, so the highlight stays put.
      if (row.dataset.status === d.status) return;
      row.dataset.status = d.status;
      const actions = row.querySelector('.dl-actions');
      const hadFocus = actions.contains(App.focus.current);
      actions.innerHTML = '';
      const button = (key, icon, label, onclick, primary) => actions.appendChild(h('button', {
        class: 'btn focusable' + (primary ? ' primary' : ''), 'data-key': key, title: label, onclick: onclick,
        html: App.icons[icon] + '<span>' + App.esc(label) + '</span>',
      }));
      if (done) {
        button('play', 'play', t('player.play'), () => this.play(d), true);
        button('show', 'folder', t('downloads.openFolder'), () => App.downloads.show(d.id));
      } else if (d.status === 'paused' || d.status === 'error') {
        button('resume', 'download', t('downloads.resume'), () => App.downloads.resume(d.id), true);
      } else {
        button('pause', 'pause', t('downloads.pause'), () => App.downloads.pause(d.id));
      }
      button('delete', 'trash', t('downloads.delete'), () => this.remove(d));
      if (hadFocus) App.focus.set(actions.querySelector('.focusable'));
    },

    // Plays from the file; for an episode, the other downloaded episodes of the series come next.
    play(d) {
      const sourceId = App.state.source && App.state.source.id;
      const progress = sourceId ? App.progress.get(sourceId, d.itemId) : null;
      const startMs = progress && !progress.done && progress.pos > 30000 ? progress.pos : 0;
      if (d.kind === 'movie') {
        App.router.go('vodPlayer', {
          kind: 'movie', title: d.title, item: { id: d.itemId, name: d.title }, url: App.downloads.fileUrl(d),
          startMs: startMs, backTo: 'downloads',
        });
        return;
      }
      const queue = App.downloads.state.items
        .filter(x => x.seriesId === d.seriesId && x.sourceId === d.sourceId && x.status === 'done')
        .sort((a, b) => a.episode.season - b.episode.season || a.episode.num - b.episode.num)
        .map(x => x.episode);
      App.router.go('vodPlayer', {
        kind: 'episode', title: d.title, item: { id: d.seriesId, name: d.title },
        queue: queue, index: Math.max(0, queue.findIndex(ep => ep.id === d.itemId)),
        startMs: startMs, backTo: 'downloads',
      });
    },

    async remove(d) {
      const ok = await App.ui.choose(t('downloads.deleteConfirm', { title: d.title + (d.episode ? ' ' + t('player.episodeLabel', { s: App.fmtNum(d.episode.season), e: App.fmtNum(d.episode.num) }) : '') }), [
        { value: 'delete', label: t('downloads.delete') },
        { value: '', label: t('common.cancel') },
      ]);
      if (ok === 'delete') App.downloads.remove(d.id);
    },

    onKey(name) {
      if (name !== 'Back') return false;
      App.router.go('home');
      return true;
    },
  });
})();
