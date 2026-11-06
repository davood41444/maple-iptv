/* Add or edit a playlist: an M3U link, or an Xtream Codes server login. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;

  function hostOf(url) {
    const m = /^(?:[a-z]+:\/\/)?([^/:?#]+)/i.exec(url || '');
    return m ? m[1] : '';
  }

  App.router.register({
    name: 'sourceForm',

    show(params) {
      this.source = params.source || null;
      const src = this.source || { type: 'm3u', format: 'ts' };
      this.type = src.type;
      this.format = src.format || 'ts';
      this.render(src);
    },

    render(src) {
      const el = this.el;
      el.innerHTML = '';
      el.appendChild(App.ui.header(t(this.source ? 'form.editTitle' : 'form.addTitle')));

      this.form = h('div', { class: 'form scroller' }, [
        this.field(t('form.type'), this.segmented([['m3u', t('form.type.m3u')], ['xtream', t('form.type.xtream')]], this.type, value => {
          this.type = value;
          this.updateType();
        })),
        this.input('name', t('form.name'), src.name, t('form.namePlaceholder')),
        this.input('url', t('form.url'), src.url, 'http://example.com/playlist.m3u', 'only-m3u', true),
        this.input('server', t('form.server'), src.server, 'http://example.com:8080', 'only-xtream', true),
        this.input('username', t('form.username'), src.username, '', 'only-xtream', true),
        this.input('password', t('form.password'), src.password, '', 'only-xtream', true, 'password'),
        h('div', { class: 'only-xtream' }, [
          this.field(t('form.format'), this.segmented([['ts', t('form.format.ts')], ['hls', t('form.format.hls')]], this.format, value => {
            this.format = value;
          })),
        ]),
        h('p', { class: 'form-tip', text: t('form.tip') }),
        h('div', { class: 'form-actions' }, [
          h('button', { class: 'btn primary big focusable', text: t('common.save'), onclick: () => this.save() }),
          h('button', { class: 'btn big focusable', text: t('common.cancel'), onclick: () => this.leave() }),
        ]),
      ]);
      el.appendChild(this.form);
      this.updateType();
      App.focus.set(this.form.querySelector('.segmented .selected'));
    },

    field(label, control, extraClass) {
      return h('div', { class: 'field ' + (extraClass || '') }, [h('div', { class: 'field-label', text: label }), control]);
    },

    // Addresses and logins are always left-to-right, even in the Persian interface.
    input(key, label, value, placeholder, extraClass, ltr, type) {
      const input = h('input', {
        class: 'input focusable',
        type: type || 'text',
        value: value || '',
        placeholder: placeholder || '',
        dir: ltr ? 'ltr' : null,
        'data-key': key,
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
      });
      return this.field(label, input, extraClass);
    },

    segmented(options, current, onChange) {
      const wrap = h('div', { class: 'segmented' });
      options.forEach(o => {
        const btn = h('button', {
          class: 'btn focusable' + (o[0] === current ? ' selected' : ''),
          text: o[1],
          onclick: () => {
            Array.prototype.forEach.call(wrap.children, b => b.classList.toggle('selected', b === btn));
            onChange(o[0]);
          },
        });
        wrap.appendChild(btn);
      });
      return wrap;
    },

    updateType() {
      this.form.classList.toggle('type-m3u', this.type === 'm3u');
      this.form.classList.toggle('type-xtream', this.type === 'xtream');
    },

    value(key) {
      return (this.form.querySelector('[data-key="' + key + '"]').value || '').trim();
    },

    async save() {
      const id = this.source ? this.source.id : App.uid();
      let src;
      if (this.type === 'm3u') {
        src = { id: id, type: 'm3u', name: this.value('name'), url: this.value('url') };
        if (!src.url) return this.missing('url', 'form.url');
        if (!/^https?:\/\//i.test(src.url)) src.url = 'http://' + src.url;
        if (!src.name) src.name = hostOf(src.url);
      } else {
        src = {
          id: id, type: 'xtream', name: this.value('name'), format: this.format,
          server: this.value('server'), username: this.value('username'), password: this.value('password'),
        };
        if (!src.server) return this.missing('server', 'form.server');
        if (!src.username) return this.missing('username', 'form.username');
        if (!src.password) return this.missing('password', 'form.password');
        if (!src.name) src.name = hostOf(src.server);
      }
      // The connection details may have changed, so don't reuse the cached list.
      await App.cache.del(id);
      await App.openSource(src, { force: true, loadingText: t('form.checking') });
    },

    missing(key, labelKey) {
      App.ui.toast(t('form.required', { field: t(labelKey) }), 'error');
      App.focus.set(this.form.querySelector('[data-key="' + key + '"]'));
    },

    leave() {
      App.router.go('sources', { focusId: this.source && this.source.id });
    },

    onKey(name) {
      if (name !== 'Back') return false;
      this.leave();
      return true;
    },
  });
})();
