/* Admin panel (see src/admin.js): loads the summary, installs and licenses. */
(function () {
  'use strict';
  const API = '/maple-iptv/admin/api/';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => new Intl.NumberFormat('fa-IR').format(n || 0);
  const STATUS = { trial: 'تریال', coupon: 'کوپن', license: 'لایسنس سایت', subscription: 'گوگل‌پلی', free: 'رایگان', unlimited: 'نامحدود' };
  const LSTATUS = { active: 'فعال', past_due: 'پرداخت معوق', canceled: 'لغوشده', revoked: 'باطل‌شده' };

  function when(ms) {
    if (!ms) return '—';
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return 'همین حالا';
    if (mins < 60) return num(mins) + ' دقیقه پیش';
    if (mins < 1440) return num(Math.round(mins / 60)) + ' ساعت پیش';
    if (mins < 43200) return num(Math.round(mins / 1440)) + ' روز پیش';
    return new Date(ms).toLocaleDateString('fa-IR');
  }
  const date = ms => (ms ? new Date(ms).toLocaleDateString('fa-IR') : '—');

  async function get(path) {
    const res = await fetch(API + path, { credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
    return res.json();
  }
  async function post(path, body) {
    const res = await fetch(API + path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || res.status);
    return data;
  }

  function bars(el, rows, label) {
    const max = Math.max(1, ...rows.map(r => r.n));
    el.innerHTML = rows.length ? rows.map(r => '<div class="bar-row"><span class="bar-k">' + esc(label ? label(r.k) : (r.k || '—')) +
      '</span><span class="bar-track"><i style="width:' + (r.n / max * 100) + '%"></i></span><span class="bar-n">' + num(r.n) + '</span></div>').join('') : '<p class="empty">هنوز چیزی نیست</p>';
  }

  async function loadSummary() {
    const s = await get('summary');
    const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: s.currency.toUpperCase() }).format(s.mrr);
    $('cards').innerHTML = [
      ['کل نصب‌ها', num(s.installs)],
      ['فعال در ۷ روز', num(s.active7)],
      ['فعال در ۳۰ روز', num(s.active30)],
      ['نصب جدید در ۷ روز', num(s.new7)],
      ['اشتراک‌های فعال سایت', num(s.licenses.valid) + '<small>ماهانه ' + num(s.licenses.monthly) + ' · سالانه ' + num(s.licenses.yearly) + '</small>'],
      ['درآمد ماهانه (تخمینی)', money + '<small>Stripe ' + num(s.licenses.stripe) + ' · PayPal ' + num(s.licenses.paypal) + '</small>'],
    ].map(c => '<div class="card"><span>' + c[0] + '</span><strong>' + c[1] + '</strong></div>').join('');
    bars($('byPlatform'), s.byPlatform);
    bars($('byStatus'), s.byStatus, k => STATUS[k] || k);
    bars($('byCountry'), s.byCountry);
    bars($('coupons'), s.coupons);
    const ok = (yes, text) => '<li class="' + (yes ? 'ok' : 'todo') + '">' + (yes ? '✓ ' : '○ ') + text + '</li>';
    $('setup').innerHTML = ok(s.setup.stripe, 'کلید Stripe') + ok(s.setup.stripeWebhook, 'Webhook استرایپ') +
      ok(s.setup.paypal, 'کلیدهای PayPal (حالت: ' + s.setup.paypalMode + ')') + ok(s.setup.paypalPlans, 'پلن‌های PayPal') + ok(s.setup.paypalWebhook, 'Webhook پی‌پال');
    $('paypalSetup').hidden = !s.setup.paypal || s.setup.paypalPlans;
  }

  // ---- Installs ----
  let offset = 0;
  const PAGE = 50;
  async function loadInstalls() {
    const params = new URLSearchParams({ q: $('q').value, status: $('status').value, platform: $('platform').value, limit: PAGE, offset: offset });
    const data = await get('installs?' + params);
    $('installsTotal').textContent = '(' + num(data.total) + ')';
    $('installs').querySelector('tbody').innerHTML = data.rows.map(r => '<tr>' +
      '<td>' + when(r.last_seen) + '</td>' +
      '<td><b>' + esc(r.platform) + '</b><br><small>' + esc(r.device) + ' · ' + esc(r.os) + '</small></td>' +
      '<td>' + esc(r.app_version) + '</td>' +
      '<td><span class="pill ' + esc(r.status) + '">' + esc(STATUS[r.status] || r.status) + '</span>' +
        (r.status === 'trial' && r.trial_days != null ? '<br><small>' + num(r.trial_days) + ' روز مانده</small>' : '') +
        (r.coupon ? '<br><small dir="ltr">' + esc(r.coupon) + '</small>' : '') + (r.license_code ? '<br><small dir="ltr">' + esc(r.license_code) + '</small>' : '') + '</td>' +
      '<td dir="ltr">' + esc(r.iptv_user || '—') + (r.iptv_host ? '<br><small>' + esc(r.iptv_host) + '</small>' : '') + '</td>' +
      '<td dir="ltr">' + esc(r.ip) + '</td>' +
      '<td>' + esc([r.city, r.region, r.country].filter(Boolean).join('، ')) + '</td>' +
      '<td>' + date(r.first_seen) + '</td>' +
      '</tr>').join('') || '<tr><td colspan="8" class="empty">نصبی پیدا نشد</td></tr>';
    $('page').textContent = num(Math.floor(offset / PAGE) + 1) + ' از ' + num(Math.max(1, Math.ceil(data.total / PAGE)));
    $('prev').disabled = offset === 0;
    $('next').disabled = offset + PAGE >= data.total;
  }

  // ---- Licenses ----
  async function loadLicenses() {
    const data = await get('licenses?' + new URLSearchParams({ q: $('lq').value }));
    $('licenses').querySelector('tbody').innerHTML = data.rows.map(r => '<tr>' +
      '<td dir="ltr" class="code">' + esc(r.code) + '</td>' +
      '<td dir="ltr">' + esc(r.email || '—') + (r.note ? '<br><small>' + esc(r.note) + '</small>' : '') + '</td>' +
      '<td>' + ({ monthly: 'ماهانه', yearly: 'سالانه', manual: 'دستی' }[r.plan] || esc(r.plan)) + '</td>' +
      '<td>' + esc(r.provider) + '</td>' +
      '<td><span class="pill ' + (r.valid ? 'ok' : 'bad') + '">' + esc(LSTATUS[r.status] || r.status) + '</span></td>' +
      '<td>' + date(r.period_end) + '</td>' +
      '<td>' + num(r.devices) + '</td>' +
      '<td class="actions">' +
        (r.status === 'revoked' ? '<button data-act="restore" data-code="' + esc(r.code) + '">فعال کردن</button>' : '<button data-act="revoke" data-code="' + esc(r.code) + '">باطل کردن</button>') +
        '<button data-act="extend" data-code="' + esc(r.code) + '">+۳۰ روز</button></td>' +
      '</tr>').join('') || '<tr><td colspan="8" class="empty">هنوز لایسنسی نیست</td></tr>';
  }

  $('licenses').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'revoke' && !confirm('این لایسنس باطل شود؟ اپ‌ها در بررسی بعدی Premium را از دست می‌دهند.')) return;
    await post('license', { action: b.dataset.act, code: b.dataset.code, days: 30 });
    loadLicenses();
  });

  $('newLicense').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const data = await post('license', { action: 'create', email: f.get('email'), days: f.get('days'), note: f.get('note') });
    $('newCode').textContent = data.code;
    loadLicenses();
  });

  $('paypalSetup').addEventListener('click', async () => {
    $('paypalResult').textContent = '…';
    try {
      const data = await post('paypal-setup');
      $('paypalResult').textContent = '✓ ' + data.plans.monthly + ' / ' + data.plans.yearly;
      loadSummary();
    } catch (e) {
      $('paypalResult').textContent = 'خطا: ' + e.message;
    }
  });

  let timer = 0;
  const later = fn => () => { clearTimeout(timer); timer = setTimeout(fn, 300); };
  $('q').addEventListener('input', later(() => { offset = 0; loadInstalls(); }));
  $('status').addEventListener('change', () => { offset = 0; loadInstalls(); });
  $('platform').addEventListener('change', () => { offset = 0; loadInstalls(); });
  $('prev').addEventListener('click', () => { offset = Math.max(0, offset - PAGE); loadInstalls(); });
  $('next').addEventListener('click', () => { offset += PAGE; loadInstalls(); });
  $('lq').addEventListener('input', later(loadLicenses));

  loadSummary();
  loadInstalls();
  loadLicenses();
})();
