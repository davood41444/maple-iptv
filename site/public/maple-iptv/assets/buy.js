/* Buy page: Stripe Checkout (card, Apple Pay, Google Pay) and PayPal subscription buttons. */
(function () {
  'use strict';
  const cfg = window.MAPLE_BUY;
  const API = '/maple-iptv/api/';
  const error = document.getElementById('payError');
  const plan = () => document.querySelector('input[name=plan]:checked').value;

  function fail(e) {
    if (e) console.error(e);
    error.textContent = cfg.error;
    error.hidden = false;
  }

  async function post(path, body) {
    const res = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || res.status);
    return data;
  }

  const stripe = document.getElementById('stripe');
  if (stripe) {
    stripe.addEventListener('click', async () => {
      stripe.disabled = true;
      error.hidden = true;
      try {
        location.href = (await post('stripe/checkout', { plan: plan(), lang: cfg.lang })).url;
      } catch (e) {
        fail(e);
        stripe.disabled = false;
      }
    });
  }

  if (cfg.paypal && window.paypal) {
    window.paypal.Buttons({
      style: { shape: 'pill', color: 'gold', layout: 'vertical', label: 'subscribe', height: 48 },
      createSubscription: (data, actions) => actions.subscription.create({ plan_id: cfg.paypal[plan()] }),
      onApprove: async data => {
        try {
          await post('paypal/activate', { subscriptionId: data.subscriptionID });
          location.href = '/maple-iptv/success?lang=' + cfg.lang + '&subscription=' + encodeURIComponent(data.subscriptionID);
        } catch (e) {
          fail(e);
        }
      },
      onError: fail,
    }).render('#paypal');
  }
})();
