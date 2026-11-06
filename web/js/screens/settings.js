(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;

  const ASPECTS = ['fit', 'fill', 'zoom'];
  const SUBTITLES = ['fa', 'en', 'off'];

  // A setting picked from a list; option labels are the locale keys '<key>.<value>'.
  function option(key, values, after) {
    return {
      key: key,
      label: t('settings.' + key),
      value: () => t(key + '.' + App.settings.get(key)),
      action: () => App.ui.choose(t('settings.' + key), values.map(v => ({ value: v, label: t(key + '.' + v) })), App.settings.get(key))
        .then(value => {
          if (!value) return;
          App.settings.set(key, value);
          if (after) after(value);
        }),
    };
  }

  App.router.register({
    name: 'settings',

    rows() {
      const source = App.state.source;
      const subtitleStyle = () => App.player.applySubtitleStyle();
      return [
        {
          key: 'lang',
          label: t('settings.language'),
          value: () => App.i18n.languages.find(l => l.code === App.i18n.lang).name,
          action: () => App.chooseLanguage('[data-key="lang"]'),
        },
        {
          key: 'playlists',
          label: t('settings.playlists'),
          value: () => (source ? source.name : ''),
          action: () => App.router.go('sources', { focusId: source && source.id }),
        },
        source && {
          key: 'refresh',
          label: t('settings.refresh'),
          value: () => '',
          action: () => App.refreshAll(),
        },
        source && {
          key: 'clearRecent',
          label: t('settings.clearRecent'),
          value: () => '',
          action: () => App.ui.confirm(t('settings.clearRecentConfirm'), t('common.delete')).then(ok => {
            if (!ok) return;
            App.lists.clearRecent(source.id);
            App.ui.toast(t('settings.recentCleared'));
          }),
        },
        source && {
          key: 'clearHistory',
          label: t('settings.clearHistory'),
          value: () => '',
          action: () => App.ui.confirm(t('settings.clearHistoryConfirm'), t('common.delete')).then(ok => {
            if (!ok) return;
            App.progress.clear(source.id);
            App.ui.toast(t('settings.historyCleared'));
          }),
        },
        !App.premium.unlimited && {
          key: 'premium',
          label: t('settings.premium'),
          value: () => App.router.screens.premium.statusText(),
          action: () => App.router.go('premium', { back: 'settings', backParams: { focus: '[data-key="premium"]' } }),
        },
        {
          key: 'pin',
          label: t('settings.pin'),
          value: () => t(App.parental.hasPin() ? 'pin.on' : 'pin.off'),
          action: () => App.parental.manage(),
        },
        {
          key: 'resume',
          label: t('settings.resume'),
          value: () => t(App.settings.get('resumeLast') ? 'common.on' : 'common.off'),
          action: () => App.settings.set('resumeLast', !App.settings.get('resumeLast')),
        },
        {
          key: 'up',
          label: t('settings.upKey'),
          value: () => t(App.settings.get('upIsNext') ? 'settings.upNext' : 'settings.upPrev'),
          action: () => App.settings.set('upIsNext', !App.settings.get('upIsNext')),
        },
        {
          key: 'subtitles',
          label: t('settings.subtitles'),
          value: () => t('subs.' + App.settings.get('subtitles')),
          action: () => App.ui.choose(t('settings.subtitles'), SUBTITLES.map(s => ({ value: s, label: t('subs.' + s) })), App.settings.get('subtitles'))
            .then(value => {
              if (!value) return;
              App.settings.set('subtitles', value);
              App.player.setSubtitleLanguage(value);
            }),
        },
        option('subSize', App.subtitleOptions.subSize, subtitleStyle),
        option('subColor', App.subtitleOptions.subColor, subtitleStyle),
        option('subBackground', App.subtitleOptions.subBackground, subtitleStyle),
        option('subFont', App.subtitleOptions.subFont, subtitleStyle),
        {
          key: 'aspect',
          label: t('settings.aspect'),
          value: () => t('aspect.' + App.settings.get('aspect')),
          action: () => App.ui.choose(t('settings.aspect'), ASPECTS.map(a => ({ value: a, label: t('aspect.' + a) })), App.settings.get('aspect'))
            .then(value => { if (value) App.settings.set('aspect', value); }),
        },
        {
          key: 'reporting',
          label: t('settings.reporting'),
          value: () => t(App.report.allowed() ? 'common.on' : 'common.off'),
          action: () => {
            App.settings.set('reporting', !App.report.allowed());
            App.report.send();
          },
        },
        App.update.supported() && {
          key: 'update',
          label: t('update.check'),
          value: () => App.update.available ? t('update.newVersion', { v: App.localDigits(App.update.available.version) }) : '',
          action: () => App.update.check(true),
        },
        {
          key: 'about',
          label: t('settings.about'),
          value: () => t('app.name') + '  ·  ' + t('settings.version', { v: App.localDigits(App.version) }),
          action: () => App.ui.info(t('app.name'), [
            t('settings.version', { v: App.localDigits(App.version) }),
            t('about.developer', { name: App.company.name }),
            t('about.support', { email: App.company.email }),
            t('about.privacy', { url: App.premium.SITE.replace('https://', '') + '/privacy' }),
            t('about.installId', { id: App.report.installId() }),
          ]),
        },
      ].filter(Boolean);
    },

    show(params) {
      const el = this.el;
      el.innerHTML = '';
      el.appendChild(App.ui.header(t('settings.title')));
      const list = h('div', { class: 'settings-list scroller' });
      this.rows().forEach(row => {
        const value = h('span', { class: 'settings-value', text: row.value() });
        list.appendChild(h('button', {
          class: 'settings-row focusable' + (row.action ? '' : ' static'),
          'data-key': row.key,
          onclick: () => {
            if (!row.action) return;
            Promise.resolve(row.action()).then(() => { value.textContent = row.value(); });
          },
        }, [h('span', { class: 'settings-label', text: row.label }), value]));
      });
      el.appendChild(list);
      App.focus.set((params.focus && el.querySelector(params.focus)) || list.firstChild);
    },

    onKey(name) {
      if (name !== 'Back') return false;
      App.router.go(App.state.playlist ? 'home' : 'sources');
      return true;
    },
  });
})();
