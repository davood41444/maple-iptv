/* Saved playlists: pick one to watch, add, edit or delete. Also the welcome screen. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;

  App.router.register({
    name: 'sources',

    show(params) {
      this.render(params.focusId);
    },

    render(focusId) {
      const el = this.el;
      el.innerHTML = '';
      const sources = App.sourcesStore.all();
      const activeId = App.settings.get('activeSource');

      el.appendChild(App.ui.header(t('sources.title'), [
        App.ui.iconButton('globe', App.i18n.languages.find(l => l.code === App.i18n.lang).name,
          () => App.chooseLanguage('.lang-btn'), 'lang-btn'),
      ]));

      const body = h('div', { class: 'sources-body scroller' });
      if (!sources.length) {
        body.appendChild(h('div', { class: 'welcome' }, [
          h('div', { class: 'welcome-icon' }, [h('img', { src: 'img/logo-mark.png', alt: '' })]),
          h('h1', { text: t('sources.welcomeTitle') }),
          h('p', { text: t('sources.welcomeText') }),
        ]));
      }

      sources.forEach(src => {
        const meta = [t(src.type === 'xtream' ? 'form.type.xtream' : 'form.type.m3u')];
        if (src.expires) meta.push(t('sources.expires', { date: App.fmtDate(src.expires) }));
        body.appendChild(h('div', { class: 'source-row' }, [
          h('button', { class: 'source-main focusable', 'data-id': src.id, onclick: () => App.openSource(src) }, [
            h('span', { class: 'source-name' }, [
              src.name,
              src.id === activeId ? h('span', { class: 'badge accent', text: t('sources.active') }) : null,
            ]),
            h('span', { class: 'source-meta', text: meta.join('  ·  ') }),
          ]),
          h('button', { class: 'btn focusable', text: t('common.edit'), onclick: () => App.router.go('sourceForm', { source: src }) }),
          h('button', { class: 'btn danger focusable', text: t('common.delete'), onclick: () => this.remove(src) }),
        ]));
      });

      body.appendChild(h('div', { class: 'add-row' }, [
        h('button', {
          class: 'btn primary big focusable add-source',
          text: '+  ' + t('sources.add'),
          onclick: () => App.router.go('sourceForm', {}),
        }),
        App.phoneAddSupported() ? h('button', {
          class: 'btn big focusable',
          html: App.icons.phone + '<span>' + App.esc(t('phone.button')) + '</span>',
          onclick: () => App.router.go('phoneAdd', { back: 'sources' }),
        }) : null,
      ]));
      el.appendChild(body);

      App.focus.set((focusId && el.querySelector('[data-id="' + focusId + '"]')) ||
        el.querySelector('.source-main') || el.querySelector('.add-source'));
    },

    async remove(src) {
      if (!(await App.ui.confirm(t('sources.deleteConfirm', { name: src.name }), t('common.delete')))) return;
      App.sourcesStore.remove(src.id);
      if (App.state.source && App.state.source.id === src.id) {
        App.state.source = null;
        App.state.playlist = null;
        App.settings.set('activeSource', null);
      }
      this.render();
    },

    onKey(name) {
      if (name !== 'Back') return false;
      if (App.state.playlist) App.router.go('home');
      else App.backToExit();
      return true;
    },
  });
})();
