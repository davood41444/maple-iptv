/* Search channels, movies and series of the current playlist by name. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;
  const MAX_PER_KIND = 300;

  function matches(list, query) {
    const found = [];
    for (let i = 0; i < list.length && found.length < MAX_PER_KIND; i++) {
      const x = list[i];
      if (x.searchName == null) x.searchName = App.normalize(x.name);
      if (x.searchName.indexOf(query) >= 0) found.push(x);
    }
    return found;
  }

  App.router.register({
    name: 'search',

    build() {
      this.input = h('input', {
        class: 'input search-input focusable',
        type: 'text',
        placeholder: t('search.placeholder'),
        autocomplete: 'off',
        spellcheck: 'false',
      });
      this.input.addEventListener('input', App.debounce(() => this.update(), 300));
      this.input._onSubmit = () => {
        if (this.results.items.length) App.focus.set(this.results.el);
      };
      this.count = h('div', { class: 'panel-title' });
      this.results = new App.VirtualList({
        rowHeight: 104,
        columns: 2,
        className: 'channels results',
        renderRow: r => this.row(r),
        onSelect: (r, i, column) => this.open(r, i, column),
      });
      this.el.appendChild(App.ui.header(t('search.title')));
      this.el.appendChild(h('div', { class: 'search-body' }, [
        this.input,
        h('div', { class: 'panel results-panel' }, [this.count, this.results.el]),
      ]));
    },

    show(params) {
      if (params.keep || params.channelId) {
        // Back from a title or the player: keep the results where they were.
        const index = params.channelId ? this.results.items.findIndex(r => r.item.id === params.channelId) : this.results.index;
        this.results.refresh();
        if (index >= 0) this.results.select(index, true);
        App.focus.set(this.results.el);
        return;
      }
      this.from = params.from || 'home';
      this.fromParams = params.fromParams || {};
      this.update();
      App.focus.set(this.input);
      App.startEditing(this.input);
      // Movies and series may still be loading; search them once they are in.
      ['movies', 'series'].forEach(kind => {
        if (!App.vod.loaded(kind)) {
          App.vod.load(kind).then(() => { if (App.router.current === this) this.update(); }, () => {});
        }
      });
    },

    update() {
      const query = App.normalize(this.input.value.trim());
      if (!query) {
        this.count.textContent = '';
        this.results.setItems([], 0, App.esc(t('search.hint')));
        return;
      }
      const results = App.parental.filter(matches(App.state.playlist.channels, query)).map(item => ({ kind: 'live', item: item }));
      ['movies', 'series'].forEach(kind => {
        const library = App.vod.loaded(kind);
        if (library) App.parental.filter(matches(library.items, query)).forEach(item => results.push({ kind: kind, item: item }));
      });
      // Actors: names from the series cast lists first, and always a way to look the typed name up.
      if (query.length >= 3) {
        const typed = this.input.value.trim();
        const names = App.people.findNames(typed);
        results.unshift.apply(results, names.map(n => ({ kind: 'person', item: { id: 'p:' + n, name: n } })));
        if (!names.some(n => App.normalize(n) === query)) results.push({ kind: 'person', item: { id: 'p?' + typed, name: typed, typed: true } });
      }
      this.count.textContent = results.length ? t('search.count', { count: App.fmtNum(results.length) }) : '';
      this.results.setItems(results, 0, App.esc(t('search.noResults', { q: this.input.value.trim() })));
    },

    row(r) {
      const sourceId = App.state.source.id;
      if (r.kind === 'live') return App.ui.channelRow(r.item, App.lists.isFavorite(sourceId, r.item.id));
      const text = (name, sub) => '<span class="ch-text"><span class="ch-name"><span>' + App.esc(name) + '</span></span>' +
        '<span class="ch-sub">' + App.esc(sub) + '</span></span>';
      if (r.kind === 'person') {
        return '<span class="ch-logo person-icon">' + App.icons.person + '</span>' +
          text(r.item.typed ? t('search.findActor', { q: r.item.name }) : r.item.name, t('search.actor'));
      }
      const item = r.item;
      const favorite = App.lists.isFavorite(sourceId, item.id, r.kind);
      return '<span class="ch-logo poster-thumb"><span class="ch-initials">' + App.esc(App.initials(item.name)) + '</span>' +
        (item.poster ? '<img src="' + App.esc(item.poster) + '" alt="" onerror="this.remove()">' : '') + '</span>' +
        text(item.name, t(r.kind === 'movies' ? 'search.movie' : 'search.series') + (item.year ? '  ·  ' + App.localDigits(item.year) : '')) +
        '<span class="ch-fav' + (favorite ? ' on' : '') + '">' + App.icons.star + '</span>';
    },

    open(r, index, column) {
      const sourceId = App.state.source.id;
      if (r.kind === 'person') {
        App.router.go('person', { name: r.item.name, from: 'search', fromParams: { keep: true } });
        return;
      }
      if (column === 1) {
        App.ui.toast(t(App.lists.toggleFavorite(sourceId, r.item.id, r.kind) ? 'fav.added' : 'fav.removed'));
        this.results.refreshRow(index);
        return;
      }
      if (r.kind !== 'live') {
        App.router.go('details', { kind: r.kind, item: r.item, from: 'search' });
        return;
      }
      if (!App.premium.check(App.premium.canPlayChannel(r.item))) return;
      const channels = this.results.items.filter(x => x.kind === 'live').map(x => x.item);
      App.router.go('player', { list: channels, index: channels.indexOf(r.item), from: 'search' });
    },

    onKey(name) {
      if (name !== 'Back') return false;
      App.router.go(this.from || 'home', this.fromParams);
      return true;
    },
  });
})();
