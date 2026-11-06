/* The Premium screen: trial status, Google Play plans and code entry. params: { back, backParams } */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;

  App.router.register({
    name: 'premium',

    build() {
      App.events.on('premium', () => {
        if (App.router.current === this) this.render();
      });
    },

    show(params) {
      this.params = params;
      this.render();
    },

    statusText() {
      const s = App.premium.status();
      switch (s.kind) {
        case 'trial': return t('premium.trialLeft', { days: App.fmtNum(s.days) });
        case 'free': return t('premium.trialEnded');
        case 'coupon': return s.expires ? t('premium.activeCoupon', { date: App.fmtDate(s.expires) }) : t('premium.activeForever');
        case 'license': return t('premium.activeLicense', { date: App.fmtDate(s.expires) });
        default: return t('premium.active');
      }
    },

    planButtons() {
      const premium = App.premium;
      if (App.ios) return this.appStoreButtons();
      if (premium.subscribed || premium.license()) return [];
      if (premium.billing === 'loading') return [h('p', { class: 'premium-note', text: t('premium.loadingPlans') })];
      // Not the Google Play version: buy on the website (never offered next to Google Play's own plans).
      if (premium.billing !== 'ready') return this.websiteButtons();
      const label = plan => {
        if (plan.id === 'monthly') return t('premium.monthly') + '  ·  ' + t('premium.perMonth', { price: plan.price });
        if (plan.id === 'yearly') return t('premium.yearly') + '  ·  ' + t('premium.perYear', { price: plan.price });
        return plan.id + '  ·  ' + plan.price;
      };
      // Yearly first: it is the better deal.
      const plans = premium.plans.slice().sort((a, b) => (a.id === 'yearly' ? -1 : b.id === 'yearly' ? 1 : 0));
      return plans.map(plan => h('button', {
        class: 'btn big primary focusable premium-plan', 'data-key': 'plan-' + plan.id, text: label(plan),
        onclick: () => premium.buy(plan.id),
      })).concat([h('p', { class: 'premium-note', text: t('premium.playNote') })]);
    },

    // iPhone/iPad: App Store subscriptions only — Apple doesn't allow pointing to the website
    // to pay — with the restore button, renewal terms and policy links its rules ask for.
    appStoreButtons() {
      const premium = App.premium;
      const site = App.premium.SITE;
      const lang = App.i18n.lang === 'fa' ? 'fa' : 'en';
      const link = (text, path) => h('button', {
        class: 'btn focusable premium-link', text: text,
        onclick: () => window.AndroidHost.openUrl(site + path + '?lang=' + lang),
      });
      const footer = [
        h('div', { class: 'premium-links' }, [
          h('button', { class: 'btn focusable premium-link', 'data-key': 'restore', text: t('premium.restore'), onclick: () => premium.restore() }),
          link(t('premium.terms'), '/terms'),
          link(t('premium.privacyPolicy'), '/privacy'),
        ]),
      ];
      if (premium.subscribed || premium.license()) return footer;
      if (premium.billing === 'loading') return [h('p', { class: 'premium-note', text: t('premium.loadingPlans') })].concat(footer);
      if (premium.billing !== 'ready') return [h('p', { class: 'premium-note', text: t('premium.storeUnavailable') })].concat(footer);
      const label = plan => (plan.id === 'yearly'
        ? t('premium.yearly') + '  ·  ' + t('premium.perYear', { price: plan.price })
        : t('premium.monthly') + '  ·  ' + t('premium.perMonth', { price: plan.price }));
      const plans = premium.plans.slice().sort((a, b) => (a.id === 'yearly' ? -1 : b.id === 'yearly' ? 1 : 0));
      return plans.map(plan => h('button', {
        class: 'btn big primary focusable premium-plan', 'data-key': 'plan-' + plan.id, text: label(plan),
        onclick: () => premium.buy(plan.id),
      })).concat([h('p', { class: 'premium-note', text: t('premium.appleNote') })], footer);
    },

    // Computers and phones open the buy page; TVs show it as a QR code for a phone.
    websiteButtons() {
      const url = App.premium.SITE + '/buy?lang=' + (App.i18n.lang === 'fa' ? 'fa' : 'en');
      const note = h('p', { class: 'premium-note', text: t('premium.websiteNote') });
      if (App.platform === 'desktop' || App.touch) {
        return [
          h('button', {
            class: 'btn big primary focusable premium-plan', 'data-key': 'website', text: t('premium.buyWebsite'),
            onclick: () => (App.platform === 'android' ? window.AndroidHost.openUrl(url) : window.open(url, '_blank')),
          }),
          note,
        ];
      }
      const qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      return [h('div', { class: 'premium-website' }, [
        h('div', { class: 'premium-qr', html: qr.createSvgTag(5, 2) }),
        h('div', {}, [
          h('div', { class: 'premium-website-title', text: t('premium.scanToBuy') }),
          h('div', { class: 'premium-website-url', dir: 'ltr', text: url.replace('https://', '').replace(/\?.*$/, '') }),
          note,
        ]),
      ])];
    },

    render() {
      const el = this.el;
      const focusedKey = App.focus.current && App.focus.current.getAttribute('data-key');
      const typed = this.input ? this.input.value : '';
      el.innerHTML = '';
      el.appendChild(App.ui.header(t('premium.badge')));

      const channels = App.state.playlist ? App.state.playlist.channels.length : 0;
      const benefit = text => h('li', {}, [h('span', { class: 'premium-check', text: '✓' }), h('span', { text: text })]);

      this.input = h('input', {
        class: 'input focusable', type: 'text', dir: 'ltr', 'data-key': 'code',
        placeholder: t('premium.couponPlaceholder'), autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
      });
      this.input.value = typed;
      this.input._onSubmit = () => this.redeem();

      el.appendChild(h('div', { class: 'premium-body' }, [
        h('div', { class: 'premium-info' }, [
          h('div', { class: 'premium-logo' }, [h('img', { src: 'img/logo-mark.png', alt: '' })]),
          h('h1', { text: t('premium.title') }),
          h('div', { class: 'premium-status ' + App.premium.status().kind, text: this.statusText() }),
          h('ul', { class: 'premium-benefits' }, [
            benefit(t('premium.benefitChannels') + (channels ? '  (' + App.fmtNum(channels) + ')' : '')),
            benefit(t('premium.benefitVod')),
            benefit(t('premium.benefitFeatures')),
          ]),
          h('p', { class: 'premium-note', text: t('premium.free', { count: App.fmtNum(App.premium.FREE_CHANNELS) }) }),
        ]),
        h('div', { class: 'premium-actions' }, this.planButtons().concat([
          h('div', { class: 'field-label', text: t('premium.coupon') }),
          h('div', { class: 'premium-code' }, [
            this.input,
            h('button', { class: 'btn big focusable', 'data-key': 'redeem', text: t('premium.redeem'), onclick: () => this.redeem() }),
          ]),
          h('p', { class: 'premium-note', text: t('about.support', { email: App.company.email }) }),
        ])),
      ]));

      App.focus.set((focusedKey && el.querySelector('[data-key="' + focusedKey + '"]')) || el.querySelector('.premium-plan') || this.input);
    },

    async redeem() {
      const code = this.input.value.trim();
      if (!code) {
        App.focus.set(this.input);
        return;
      }
      App.ui.loading(t('premium.checking'));
      const result = await App.premium.redeem(code);
      App.ui.loading(false);
      if (result === 'ok') {
        this.input.value = '';
        App.ui.toast(t('premium.redeemed'));
        this.render();
      } else {
        App.ui.toast(t('premium.' + result), 'error');
      }
    },

    onKey(name) {
      if (name !== 'Back') return false;
      App.router.go(this.params.back || 'home', Object.assign({ keep: true }, this.params.backParams || {}));
      return true;
    },
  });
})();
