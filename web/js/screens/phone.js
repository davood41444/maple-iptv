/*
 * Add a playlist by typing it on a phone (Android TV only): the TV shows a QR
 * code for a small form served by PhoneServer.kt; what the phone sends
 * arrives as a 'phone' event and is loaded like the on-TV form.
 */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const t = App.t;
  const esc = App.esc;

  App.phoneAddSupported = () => App.platform === 'android' && !!window.AndroidHost.startPhoneServer;

  function page(body) {
    return '<!doctype html><html lang="' + App.i18n.lang + '" dir="' + (App.i18n.isRtl() ? 'rtl' : 'ltr') + '"><head>' +
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maple IPTV</title><style>' +
      'body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Tahoma,sans-serif;background:#0b0f17;color:#eef2f8}' +
      'main{max-width:520px;margin:0 auto;padding:28px 20px 40px}h1{font-size:23px;margin:0 0 6px}' +
      'p{color:#8e9ab0;margin:0 0 22px;font-size:15px;line-height:1.6}.tabs{display:flex;gap:8px;margin-bottom:18px}' +
      '.tabs label{flex:1}.tabs input{display:none}.tabs span{display:block;text-align:center;padding:12px;border-radius:12px;background:#1a2333;font-weight:600}' +
      '.tabs input:checked+span{background:#f08222;color:#1b0c04}label.f{display:block;margin-bottom:14px;font-size:14px;color:#8e9ab0}' +
      'label.f input{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:13px 14px;font-size:16px;border-radius:12px;border:2px solid #243049;background:#121926;color:#eef2f8}' +
      '.ltr{direction:ltr;text-align:left}button{width:100%;padding:15px;border:0;border-radius:12px;background:#f08222;color:#1b0c04;font-size:17px;font-weight:700;margin-top:8px}' +
      'label.x{display:none}body.xtream label.x{display:block}body.xtream label.m{display:none}.ok{font-size:64px;color:#3ccf91;margin:30px 0 10px}' +
      '</style></head><body><main>' + body + '</main></body></html>';
  }

  function field(cls, name, label, type) {
    return '<label class="f ' + cls + '">' + esc(label) + '<input name="' + name + '" type="' + (type || 'text') + '"' +
      (cls ? ' class="ltr" autocapitalize="off" autocorrect="off" spellcheck="false"' : '') + '></label>';
  }

  function formPage() {
    return page('<h1>' + esc(t('app.name')) + '</h1><p>' + esc(t('phone.intro')) + '</p><form method="post">' +
      '<div class="tabs"><label><input type="radio" name="type" value="m3u" checked onchange="document.body.className=\'\'"><span>' +
      esc(t('form.type.m3u')) + '</span></label><label><input type="radio" name="type" value="xtream" onchange="document.body.className=\'xtream\'"><span>' +
      esc(t('form.type.xtream')) + '</span></label></div>' +
      '<label class="f">' + esc(t('form.name')) + '<input name="name" placeholder="' + esc(t('form.namePlaceholder')) + '"></label>' +
      field('m', 'url', t('form.url'), 'url') +
      field('x', 'server', t('form.server'), 'url') +
      field('x', 'username', t('form.username')) +
      field('x', 'password', t('form.password'), 'password') +
      '<button type="submit">' + esc(t('phone.send')) + '</button></form>');
  }

  function donePage() {
    return page('<div class="ok">✓</div><h1>' + esc(t('phone.sent')) + '</h1><p>' + esc(t('phone.lookAtTv')) + '</p>');
  }

  App.router.register({
    name: 'phoneAdd',

    build() {
      App.events.on('phone', data => {
        if (App.router.current === this) this.receive(data);
      });
    },

    show(params) {
      this.back = params.back || 'sources';
      const el = this.el;
      el.innerHTML = '';
      el.appendChild(App.ui.header(t('phone.title')));
      const url = App.phoneAddSupported() ? window.AndroidHost.startPhoneServer(formPage(), donePage()) : '';
      if (!url) {
        el.appendChild(h('div', { class: 'phone-body' }, [h('p', { class: 'phone-error', text: t('phone.unavailable') })]));
        return;
      }
      const qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      el.appendChild(h('div', { class: 'phone-body' }, [
        h('div', { class: 'phone-qr', html: qr.createSvgTag(8, 2) }),
        h('div', { class: 'phone-steps' }, [
          h('ol', {}, [t('phone.step1'), t('phone.step2'), t('phone.step3')].map(s => h('li', { text: s }))),
          h('div', { class: 'phone-url', dir: 'ltr', text: url }),
          h('div', { class: 'phone-wait' }, [h('div', { class: 'spinner small' }), h('span', { text: t('phone.waiting') })]),
        ]),
      ]));
    },

    hide() {
      if (App.phoneAddSupported()) window.AndroidHost.stopPhoneServer();
    },

    receive(data) {
      const value = key => String(data[key] || '').trim();
      const id = App.uid();
      let source;
      if (value('type') === 'xtream') {
        source = { id: id, type: 'xtream', name: value('name'), server: value('server'), username: value('username'), password: value('password'), format: 'ts' };
        if (!source.server || !source.username || !source.password) {
          App.ui.toast(t('phone.incomplete'), 'error');
          return;
        }
        if (!source.name) source.name = source.server.replace(/^\w+:\/\//, '').split(/[/:]/)[0];
      } else {
        source = { id: id, type: 'm3u', name: value('name'), url: value('url') };
        if (!source.url) {
          App.ui.toast(t('phone.incomplete'), 'error');
          return;
        }
        if (!/^https?:\/\//i.test(source.url)) source.url = 'http://' + source.url;
        if (!source.name) source.name = source.url.replace(/^\w+:\/\//, '').split(/[/:?]/)[0];
      }
      App.ui.toast(t('phone.received'));
      // On success this opens the new playlist (and leaves this screen, stopping the server).
      App.openSource(source, { force: true, loadingText: t('form.checking') });
    },

    onKey(name) {
      if (name !== 'Back') return false;
      App.router.go(this.back);
      return true;
    },
  });
})();
