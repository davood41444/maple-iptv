/* Movies or series (params.kind): categories on one side, a poster grid on the other. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;

  const SORTS = ['added', 'name', 'nameDesc', 'rating', 'year'];
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const COMPARE = {
    added: (a, b) => b.added - a.added,
    name: (a, b) => collator.compare(a.name, b.name),
    nameDesc: (a, b) => collator.compare(b.name, a.name),
    rating: (a, b) => b.rating - a.rating,
    year: (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0) || b.added - a.added,
  };

  // Sorting 26,000 titles by name takes a moment on a TV, so each order is kept.
  const sortCache = new WeakMap();
  function sorted(list, mode) {
    let byMode = sortCache.get(list);
    if (!byMode) sortCache.set(list, byMode = {});
    if (!byMode[mode]) byMode[mode] = list.slice().sort(COMPARE[mode] || COMPARE.added);
    return byMode[mode];
  }

  App.router.register({
    name: 'library',
    kind: 'movies',
    saved: {}, // per kind: { sourceId, groupId, index }

    build() {
      this.groups = new App.VirtualList({
        rowHeight: 66,
        className: 'groups',
        renderRow: App.groupRow,
        onChange: g => {
          clearTimeout(this.groupTimer);
          this.groupTimer = setTimeout(() => this.showGroup(g), 220);
        },
        onSelect: g => {
          if (g.locked) {
            App.parental.unlock().then(ok => {
              if (!ok) return;
              this.state().groupId = g.id;
              this.show({ kind: this.kind });
            });
            return;
          }
          this.showGroup(g);
          if (this.grid.items.length) App.focus.set(this.grid.el);
        },
      });
      this.grid = new App.VirtualGrid({
        columns: 5,
        rowHeight: 400,
        aspect: 1.5, // 2:3 posters
        rowExtra: 26, // room for the highlight to grow, and the gap between rows
        gap: 20,
        className: 'posters',
        renderCell: item => this.cell(item),
        onChange: (item, i) => { this.state().index = i; },
        onSelect: item => App.router.go('details', { kind: this.kind, item: item, from: 'library' }),
        onLongPress: item => this.itemOptions(item),
      });

      this.subtitle = h('div', { class: 'topbar-title' });
      this.sortButton = App.ui.iconButton('sort', '', () => this.chooseSort());
      const header = App.ui.header(null, [
        this.sortButton,
        App.ui.iconButton('search', t('live.search'), () => App.router.go('search', { from: 'library', fromParams: { kind: this.kind } })),
      ]);
      header.insertBefore(this.subtitle, header.querySelector('.topbar-spacer'));
      this.el.appendChild(header);

      this.gridTitle = h('div', { class: 'panel-title' });
      this.el.appendChild(h('div', { class: 'live-body' }, [
        h('div', { class: 'panel groups-panel' }, [h('div', { class: 'panel-title', text: t('live.categories') }), this.groups.el]),
        h('div', { class: 'panel grid-panel' }, [this.gridTitle, this.grid.el]),
      ]));
      const key = label => '<span class="key">' + label + '</span>';
      this.el.appendChild(h('footer', { class: 'hintbar', html: [
        key('OK') + t('lib.hintOpen'),
        key('OK') + t('lib.hintHold'),
        key(App.i18n.isRtl() ? '►' : '◄') + t('live.categories'),
      ].map(s => '<span>' + s + '</span>').join('') }));
    },

    // groupId null = the default category, picked once the list is loaded.
    state() {
      const source = App.state.source.id;
      let s = this.saved[this.kind];
      if (!s || s.sourceId !== source) s = this.saved[this.kind] = { sourceId: source, groupId: null, index: 0 };
      return s;
    },

    // Opens on Hollywood movies / English series when the server has such a category.
    defaultGroup() {
      const pattern = this.kind === 'movies' ? /hollywood/i : /english/i;
      const group = this.library.groups.find(g => pattern.test(g.name) && !(App.parental.locked() && App.parental.isAdultGroup(g.name)));
      return group ? group.id : 'all';
    },

    sortMode() {
      return App.settings.get('vodSort');
    },

    async chooseSort() {
      const mode = await App.ui.choose(t('sort.title'), SORTS.map(s => ({ value: s, label: t('sort.' + s) })), this.sortMode());
      if (!mode || mode === this.sortMode()) return;
      App.settings.set('vodSort', mode);
      this.updateSortLabel();
      const group = this.groupItems.find(g => g.id === this.state().groupId);
      if (group) this.showGroup(group, 0);
    },

    updateSortLabel() {
      this.sortButton.querySelector('span').textContent = t('sort.' + this.sortMode());
    },

    async show(params) {
      this.kind = params.kind || this.kind;
      const kind = this.kind;
      this.subtitle.textContent = t(kind === 'movies' ? 'home.movies' : 'home.series');
      this.updateSortLabel();
      this.groups.setItems([], 0);
      this.grid.setItems([], 0);

      let library = App.vod.loaded(kind);
      if (!library) {
        App.ui.loading(t(kind === 'movies' ? 'lib.loadingMovies' : 'lib.loadingSeries'));
        try {
          library = await App.vod.load(kind, {
            onProgress: bytes => App.ui.loading(t('loading.progress', { size: App.fmtBytes(bytes) })),
          });
        } catch (e) {
          App.ui.loading(false);
          App.ui.toast(e.kind ? e.message : t('err.parse'), 'error');
          if (App.router.current === this) App.router.go('home');
          return;
        }
        App.ui.loading(false);
      }
      if (App.router.current !== this || this.kind !== kind) return;
      this.library = library;
      this.subtitle.textContent = t(kind === 'movies' ? 'home.movies' : 'home.series') + '  ·  ' +
        t('home.titles', { count: App.fmtNum(App.parental.filter(library.items).length) });

      this.groupItems = [
        { id: 'all', label: t('lib.all') },
        { id: 'fav', label: t('live.favorites') },
        { id: 'continue', label: t('lib.continue') },
      ];
      if (library.recent.length) this.groupItems.push({ id: 'recent', label: t('lib.recent') });
      this.groupItems = this.groupItems.concat(library.groups.map(g => ({
        id: g.id,
        label: g.name || t('live.ungrouped'),
        locked: App.parental.locked() && App.parental.isAdultGroup(g.name),
      })));
      this.groupItems.forEach(g => { g.count = this.itemsFor(g.id).length; });

      const state = this.state();
      // Coming from Home starts on the default category; Back from a title keeps the place.
      if (params.fresh || !state.groupId) {
        state.groupId = this.defaultGroup();
        state.index = 0;
      }
      const groupIndex = Math.max(0, this.groupItems.findIndex(g => g.id === state.groupId));
      this.groups.setItems(this.groupItems, groupIndex);
      this.showGroup(this.groupItems[groupIndex], state.index);
      App.focus.set(this.grid.items.length ? this.grid.el : this.groups.el);
    },

    hide() {
      clearTimeout(this.groupTimer);
    },

    itemsFor(groupId) {
      const library = this.library;
      const sourceId = App.state.source.id;
      const mode = this.sortMode();
      const byIds = ids => ids.map(id => library.byId.get(id)).filter(Boolean);
      switch (groupId) {
        case 'all': return App.parental.filter(sorted(library.items, mode));
        case 'fav': return App.parental.filter(byIds(App.lists.favorites(sourceId, this.kind)).sort(COMPARE[mode]));
        case 'recent': return App.parental.filter(library.recent);
        case 'continue': {
          const ids = App.progress.recent(sourceId, this.kind === 'movies' ? 'm' : 's');
          return App.parental.filter(byIds(ids.filter(id => {
            const p = App.progress.get(sourceId, id);
            return this.kind === 'series' || (!p.done && p.pos > 0);
          })));
        }
      }
      const group = library.groups.find(g => g.id === groupId);
      if (!group || (App.parental.locked() && App.parental.isAdultGroup(group.name))) return [];
      return App.parental.filter(sorted(group.items, mode));
    },

    showGroup(group, index) {
      clearTimeout(this.groupTimer);
      const state = this.state();
      if (group.id !== state.groupId) index = 0;
      state.groupId = group.id;
      const empty = group.locked ? t('pin.lockedGroup') : ({ fav: t('lib.emptyFavorites'), continue: t('lib.emptyContinue') }[group.id] || t('live.emptyGroup'));
      this.grid.setItems(this.itemsFor(group.id), index || 0, App.esc(empty));
      state.index = this.grid.index;
      this.gridTitle.textContent = group.label;
    },

    cell(item) {
      const sourceId = App.state.source.id;
      const favorite = App.lists.isFavorite(sourceId, item.id, this.kind);
      const progress = this.kind === 'movies' ? App.progress.get(sourceId, item.id) : null;
      const percent = progress && !progress.done && progress.dur > 0 ? Math.min(100, progress.pos / progress.dur * 100) : 0;
      return '<div class="poster"><span class="poster-fallback">' + App.esc(item.name) + '</span>' +
        (item.poster ? '<img src="' + App.esc(item.poster) + '" alt="" onerror="this.remove()">' : '') +
        (item.rating ? '<span class="poster-rating">★ ' + App.fmtRating(item.rating) + '</span>' : '') +
        (favorite ? '<span class="poster-fav">' + App.icons.star + '</span>' : '') +
        '<div class="poster-title">' + App.esc(item.name) + '</div>' +
        (percent ? '<span class="poster-progress"><i style="width:' + percent.toFixed(1) + '%"></i></span>' : '') +
        '</div>';
    },

    toggleFavorite(item) {
      App.ui.toast(t(App.lists.toggleFavorite(App.state.source.id, item.id, this.kind) ? 'fav.added' : 'fav.removed'));
    },

    // Holding OK on a poster: favorite it, or take it off "Continue watching".
    async itemOptions(item) {
      const sourceId = App.state.source.id;
      const inContinue = this.state().groupId === 'continue';
      const options = [{ value: 'fav', label: t(App.lists.isFavorite(sourceId, item.id, this.kind) ? 'lib.removeFavorite' : 'lib.addFavorite') }];
      if (inContinue) options.push({ value: 'continue', label: t('lib.removeContinue') });
      const choice = await App.ui.choose(item.name, options);
      if (!choice) return;
      if (choice === 'fav') this.toggleFavorite(item);
      else {
        App.progress.remove(sourceId, item.id);
        App.ui.toast(t('lib.removedContinue'));
      }
      this.refreshLists();
    },

    // After a favorite or "Continue watching" change: new counts, and the grid redrawn in place.
    refreshLists() {
      ['fav', 'continue'].forEach(id => {
        const i = this.groupItems.findIndex(g => g.id === id);
        if (i < 0) return;
        this.groupItems[i].count = this.itemsFor(id).length;
        this.groups.refreshRow(i);
      });
      const group = this.groupItems.find(g => g.id === this.state().groupId);
      if (group && (group.id === 'fav' || group.id === 'continue')) this.showGroup(group, this.grid.index);
      else this.grid.refreshCell(this.grid.index);
      if (!this.grid.items.length) App.focus.set(this.groups.el);
    },

    onKey(name) {
      if (name === 'Back') {
        App.router.go('home');
        return true;
      }
      if ((name === 'Yellow' || name === 'Menu') && App.focus.current === this.grid.el && this.grid.current()) {
        if (name === 'Menu') this.itemOptions(this.grid.current());
        else {
          this.toggleFavorite(this.grid.current());
          this.refreshLists();
        }
        return true;
      }
      return false;
    },
  });
})();
