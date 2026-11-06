/* Manage page: the status of a Premium code, and Stripe's portal to change card or cancel. */
(function () {
  'use strict';
  const t = window.MAPLE_MANAGE.t;
  const lang = document.documentElement.lang === 'fa' ? 'fa-IR' : 'en-US';
  const form = document.getElementById('manage');
  const result = document.getElementById('manageResult');

  async function post(path, body) {
    const res = await fetch('/maple-iptv/api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || res.status);
    return data;
  }

  function show(className, text, button) {
    result.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'result ' + className;
    const p = document.createElement('p');
    p.textContent = text;
    box.appendChild(p);
    if (button) box.appendChild(button);
    result.appendChild(box);
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const code = form.code.value.trim();
    const submit = form.querySelector('button');
    submit.disabled = true;
    try {
      const data = await post('license', { code: code });
      if (data.reason === 'unknown') return show('bad', t.unknown);
      let text = data.valid ? t.active.replace('{date}', new Date(data.expires).toLocaleDateString(lang, { dateStyle: 'long' })) : t[data.reason] || t.expired;
      let button = null;
      if (data.provider === 'stripe') {
        button = document.createElement('button');
        button.className = 'btn';
        button.type = 'button';
        button.textContent = t.stripe;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            location.href = (await post('stripe/portal', { code: code })).url;
          } catch (err) {
            show('bad', t.error);
          }
        });
      } else if (data.provider === 'paypal') {
        text += ' ' + t.paypal;
      } else if (data.provider === 'manual') {
        text += ' ' + t.manual;
      }
      show(data.valid ? 'ok' : 'bad', text, button);
    } catch (err) {
      show('bad', t.error);
    } finally {
      submit.disabled = false;
    }
  });
})();
