/*
 * An actor: photo and biography from Wikipedia, and the movies and series of
 * this playlist they appear in. params: { name, from, fromParams }
 */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;

  App.router.register({
    name: 'person',

    build() {
      this.body = h('div', { class: 'person-body scroller' });
      this.el.appendChild(this.body);
    },

    show(params) {
      // Coming back from one of the titles: keep what was found.
      if (params.keep && this.person && this.params && params.name === this.params.name) {
        this.render();
        return;
      }
      this.params = params;
      this.person = null;
      this.titles = null;
      this.render();
      const name = params.name;
      App.people.details(name).then(person => {
        if (this.params !== params) return;
        this.person = person || { name: name, missing: true };
        if (App.router.current === this) this.render();
      });
      App.people.titles(name).then(titles => {
        if (this.params !== params) return;
        this.titles = titles;
        if (App.router.current === this) this.render();
      });
    },

    render() {
      const person = this.person || { name: this.params.name };
      const loading = !this.person;
      const focusedKey = App.focus.current && App.focus.current.getAttribute('data-key');
      this.body.innerHTML = '';

      const photo = h('div', { class: 'person-photo' }, [h('span', { text: App.initials(this.params.name) })]);
      if (person.photo) photo.appendChild(h('img', { src: person.photo, alt: '', onerror: e => e.target.remove() }));

      let bio;
      if (loading) bio = h('div', { class: 'details-plot loading' }, [h('div', { class: 'spinner small' })]);
      else bio = h('p', { class: 'person-bio', text: person.bio || t('person.noInfo') });

      this.body.appendChild(h('div', { class: 'person-hero' }, [
        photo,
        h('div', { class: 'details-main' }, [
          h('h1', { class: 'details-title', text: person.name || this.params.name }),
          person.description ? h('div', { class: 'details-meta', text: person.description }) : null,
          bio,
          !loading && !person.missing ? h('div', { class: 'details-label', text: t('person.source') }) : null,
        ]),
      ]));

      const section = h('div', { class: 'person-section' }, [h('div', { class: 'details-label', text: t('person.inLibrary') })]);
      if (!this.titles) {
        section.appendChild(h('div', { class: 'spinner small' }));
      } else if (!this.titles.length) {
        section.appendChild(h('p', { class: 'premium-note', text: t('person.noTitles') }));
      } else {
        const row = h('div', { class: 'person-titles' });
        App.parental.filter(this.titles.map(x => x.item)).forEach(item => {
          const kind = this.titles.find(x => x.item === item).kind;
          row.appendChild(h('button', {
            class: 'person-title focusable', 'data-key': item.id,
            onclick: () => App.router.go('details', { kind: kind, item: item, from: 'person', fromParams: this.params }),
          }, [
            h('div', { class: 'poster' }, [
              h('span', { class: 'poster-fallback', text: item.name }),
              item.poster ? h('img', { src: item.poster, alt: '', onerror: e => e.target.remove() }) : null,
            ]),
            h('div', { class: 'poster-title', text: item.name }),
          ]));
        });
        section.appendChild(h('div', { class: 'person-titles-scroll scroller' }, [row]));
      }
      this.body.appendChild(section);
      App.focus.set((focusedKey && this.body.querySelector('[data-key="' + focusedKey + '"]')) || this.body.querySelector('.person-title'));
    },

    onKey(name) {
      if (name !== 'Back') return false;
      App.router.go(this.params.from || 'details', Object.assign({ keep: true }, this.params.fromParams || {}));
      return true;
    },
  });
})();
