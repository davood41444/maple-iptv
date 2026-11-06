// Public pages in English and Persian: home (product intro), buy, success,
// manage, privacy and terms. The language comes from ?lang= or the browser.
import { html, esc, money } from './util.js';
import { plans as paypalPlans } from './paypal.js';
import { T } from './text.js';

export function language(request, url) {
  const asked = url.searchParams.get('lang');
  if (asked === 'fa' || asked === 'en') return asked;
  return /^fa\b/i.test(request.headers.get('accept-language') || '') ? 'fa' : 'en';
}

const ICONS = {
  tv: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 20.5h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 8.5l5 2.5-5 2.5z" fill="currentColor"/></svg>',
  film: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 3v18M16.5 3v18M3 8h4.5M3 12h4.5M3 16h4.5M16.5 8H21M16.5 12H21M16.5 16H21" stroke="currentColor" stroke-width="1.8"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.9l2.8 5.7 6.3.9-4.6 4.5 1.1 6.3L12 17.3l-5.6 3 1.1-6.3-4.6-4.5 6.3-.9z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  devices: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="14" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="17" y="8" width="5" height="11" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 18h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  subtitles: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6.5 13.5h4M13 13.5h4.5M6.5 16h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.5 12l2.5 2.5 4.5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  android: '<svg viewBox="0 0 24 24"><path d="M6 9h12v8.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 17.5z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6.5 8a5.5 5.5 0 0 1 11 0M8 3.5l1.3 2M16 3.5l-1.3 2M9.5 6.6h0M14.5 6.6h0M3.5 10v5M20.5 10v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  windows: '<svg viewBox="0 0 24 24"><path d="M3 5.5l7.5-1v7H3zM11.5 4.4L21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.4z" fill="currentColor"/></svg>',
  apple: '<svg viewBox="0 0 24 24"><path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.5-1-2.5-3.7zM14.2 5.8c.6-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z" fill="currentColor"/></svg>',
  samsung: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 20.5h6M12 17.5v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

function layout(lang, title, body, opts) {
  opts = opts || {};
  const t = T[lang];
  const other = lang === 'fa' ? 'en' : 'fa';
  const self = opts.path || '';
  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'fa' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(t.metaDescription)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(t.metaDescription)}">
<meta property="og:image" content="/maple-iptv/assets/shots/home.jpg">
<link rel="icon" href="/maple-iptv/assets/logo.png">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&family=Vazirmatn:wght@400;600;800&display=swap">
<link rel="stylesheet" href="/maple-iptv/assets/site.css">
</head>
<body class="${opts.bodyClass || ''}">
<header class="nav">
  <a class="logo" href="/maple-iptv/?lang=${lang}"><img src="/maple-iptv/assets/logo.png" alt=""><span>Maple IPTV</span></a>
  <nav class="links">
    <a href="/maple-iptv/?lang=${lang}#features">${t.navFeatures}</a>
    <a href="/maple-iptv/?lang=${lang}#devices">${t.navDevices}</a>
    <a href="/maple-iptv/?lang=${lang}#pricing">${t.navPricing}</a>
    <a href="/maple-iptv/?lang=${lang}#safety">${t.navSafety}</a>
    <a href="/maple-iptv/?lang=${lang}#faq">${t.navFaq}</a>
  </nav>
  <a class="lang" href="/maple-iptv${self}?lang=${other}">${lang === 'fa' ? 'English' : 'فارسی'}</a>
  <a class="btn small" href="/maple-iptv/?lang=${lang}#devices">${t.navDownload}</a>
</header>
${body}
<footer class="foot">
  <div class="foot-brand"><img src="/maple-iptv/assets/logo.png" alt=""><div><strong>Maple IPTV</strong><span>${t.footBy}</span></div></div>
  <div class="foot-links">
    <a href="/maple-iptv/manage?lang=${lang}">${t.navManage}</a>
    <a href="/maple-iptv/privacy?lang=${lang}">${t.navPrivacy}</a>
    <a href="/maple-iptv/terms?lang=${lang}">${t.navTerms}</a>
    <a href="mailto:info@mapleonlinesolutions.com">info@mapleonlinesolutions.com</a>
  </div>
  <p class="foot-note">${t.footNote}</p>
  <p class="foot-copy">© ${new Date().getFullYear()} Maple Online Solutions · <a href="https://mapleonlinesolutions.com/">mapleonlinesolutions.com</a></p>
</footer>
${opts.scripts || ''}
</body>
</html>`;
}

function prices(env) {
  const monthly = Number(env.PRICE_MONTHLY);
  const yearly = Number(env.PRICE_YEARLY);
  return {
    monthly: money(monthly, env.CURRENCY),
    yearly: money(yearly, env.CURRENCY),
    yearlyPerMonth: money(Math.round(yearly / 12), env.CURRENCY),
    save: Math.round((1 - yearly / (monthly * 12)) * 100),
  };
}

export function home(env, lang) {
  const t = T[lang];
  const p = prices(env);
  const feature = (icon, title, text) => `<div class="feature"><span class="ficon">${ICONS[icon]}</span><h3>${title}</h3><p>${text}</p></div>`;
  const device = (icon, name, text, href, label, extra) => `<div class="device"><span class="dicon">${ICONS[icon]}</span><h3>${name}</h3><p>${text}</p>
    ${!href ? `<span class="soon">${label}</span>` : href.startsWith('mailto:') ? `<a class="soon" href="${href}">${label}</a>`
      : `<a class="btn" href="${href}">${ICONS.download}<span>${label}</span></a>`}${extra || ''}</div>`;
  const faq = t.faq.map(q => `<details><summary>${q[0]}</summary><p>${q[1]}</p></details>`).join('');
  const body = `
<section class="hero">
  <div class="hero-text">
    <span class="eyebrow">${t.heroEyebrow}</span>
    <h1>${t.heroTitle}</h1>
    <p class="lead">${t.heroLead}</p>
    <div class="cta">
      <a class="btn big" href="#devices">${ICONS.download}<span>${t.heroTrial}</span></a>
      <a class="btn big ghost" href="#pricing">${t.heroPlans}</a>
    </div>
    <ul class="ticks">${t.heroTicks.map(x => `<li>${ICONS.check}<span>${x}</span></li>`).join('')}</ul>
  </div>
  <div class="hero-shot"><div class="tv"><img src="/maple-iptv/assets/shots/home.jpg" alt="${esc(t.shotHome)}"></div><div class="tv-stand"></div></div>
</section>

<section class="strip">${t.strip.map(x => `<span>${ICONS.shield}${x}</span>`).join('')}</section>

<section id="features" class="section">
  <h2>${t.featuresTitle}</h2>
  <p class="sub">${t.featuresSub}</p>
  <div class="features">
    ${feature('tv', t.f1[0], t.f1[1])}
    ${feature('film', t.f2[0], t.f2[1])}
    ${feature('star', t.f3[0], t.f3[1])}
    ${feature('download', t.f4[0], t.f4[1])}
    ${feature('devices', t.f5[0], t.f5[1])}
    ${feature('subtitles', t.f6[0], t.f6[1])}
    ${feature('lock', t.f7[0], t.f7[1])}
    ${feature('globe', t.f8[0], t.f8[1])}
  </div>
  <div class="shots">
    <figure><img loading="lazy" src="/maple-iptv/assets/shots/live.jpg" alt=""><figcaption>${t.shotLive}</figcaption></figure>
    <figure><img loading="lazy" src="/maple-iptv/assets/shots/movies.jpg" alt=""><figcaption>${t.shotMovies}</figcaption></figure>
    <figure><img loading="lazy" src="/maple-iptv/assets/shots/player.jpg" alt=""><figcaption>${t.shotPlayer}</figcaption></figure>
  </div>
</section>

<section id="devices" class="section">
  <h2>${t.devicesTitle}</h2>
  <p class="sub">${t.devicesSub}</p>
  <div class="devices">
    ${device('tv', t.dTv[0], t.dTv[1], '/maple-iptv/download/android', t.dDownloadApk, env.PLAY_STORE_URL ? `<a class="store" href="${esc(env.PLAY_STORE_URL)}">Google Play</a>` : '')}
    ${device('android', t.dPhone[0], t.dPhone[1], '/maple-iptv/download/android', t.dDownloadApk)}
    ${device('windows', t.dWin[0], t.dWin[1], env.DOWNLOAD_WINDOWS ? '/maple-iptv/download/windows' : '', env.DOWNLOAD_WINDOWS ? t.dDownloadWin : t.dSoon)}
    ${device('apple', t.dMac[0], t.dMac[1], '/maple-iptv/download/mac', t.dDownloadMac)}
    ${device('samsung', t.dSamsung[0], t.dSamsung[1], 'mailto:info@mapleonlinesolutions.com?subject=Maple%20IPTV%20Samsung', t.dContact)}
  </div>
  <p class="note">${t.devicesNote}</p>
</section>

<section id="pricing" class="section">
  <h2>${t.pricingTitle}</h2>
  <p class="sub">${t.pricingSub}</p>
  <div class="plans">
    <div class="plan"><h3>${t.planTrial}</h3><div class="price">${t.free}</div><p>${t.planTrialText}</p>
      <ul>${t.planIncludes.map(x => `<li>${ICONS.check}${x}</li>`).join('')}</ul><a class="btn ghost" href="#devices">${t.heroTrial}</a></div>
    <div class="plan"><h3>${t.planMonthly}</h3><div class="price"><bdi>${p.monthly}</bdi><small>${t.perMonth}</small></div><p>${t.planMonthlyText}</p>
      <ul>${t.planIncludes.map(x => `<li>${ICONS.check}${x}</li>`).join('')}</ul><a class="btn" href="/maple-iptv/buy?plan=monthly&lang=${lang}">${t.buy}</a></div>
    <div class="plan best"><span class="badge">${t.save.replace('{n}', p.save)}</span><h3>${t.planYearly}</h3><div class="price"><bdi>${p.yearly}</bdi><small>${t.perYear}</small></div>
      <p>${t.planYearlyText.replace('{m}', p.yearlyPerMonth)}</p>
      <ul>${t.planIncludes.map(x => `<li>${ICONS.check}${x}</li>`).join('')}</ul><a class="btn" href="/maple-iptv/buy?plan=yearly&lang=${lang}">${t.buy}</a></div>
  </div>
  <p class="note">${t.pricingNote}</p>
</section>

<section id="safety" class="section safety">
  <h2>${t.safetyTitle}</h2>
  <p class="sub">${t.safetySub}</p>
  <div class="safe-grid">${t.safety.map(x => `<div class="safe">${ICONS.shield}<div><h3>${x[0]}</h3><p>${x[1]}</p></div></div>`).join('')}</div>
</section>

<section id="faq" class="section">
  <h2>${t.faqTitle}</h2>
  <div class="faq">${faq}</div>
</section>

<section class="section final">
  <h2>${t.finalTitle}</h2>
  <p class="sub">${t.finalSub}</p>
  <div class="cta center"><a class="btn big" href="#devices">${ICONS.download}<span>${t.heroTrial}</span></a><a class="btn big ghost" href="#pricing">${t.heroPlans}</a></div>
</section>`;
  return html(layout(lang, t.title, body, { path: '/' }));
}

export async function buy(env, lang, url) {
  const t = T[lang];
  const p = prices(env);
  const plan = url.searchParams.get('plan') === 'monthly' ? 'monthly' : 'yearly';
  let paypal = null;
  try {
    paypal = env.PAYPAL_CLIENT_ID ? await paypalPlans(env) : null;
  } catch (e) { /* PayPal not set up yet */ }
  const option = (id, title, price, sub) => `<label class="option"><input type="radio" name="plan" value="${id}" ${plan === id ? 'checked' : ''}>
    <span class="option-box"><strong>${title}</strong><span class="option-price">${price}</span><small>${sub}</small></span></label>`;
  const body = `
<section class="section narrow">
  <h1>${t.buyTitle}</h1>
  <p class="sub">${t.buySub}</p>
  ${url.searchParams.get('canceled') ? `<p class="alert">${t.buyCanceled}</p>` : ''}
  <form id="plans" class="options">
    ${option('monthly', t.planMonthly, '<bdi>' + p.monthly + '</bdi> ' + t.perMonth, t.planMonthlyText)}
    ${option('yearly', t.planYearly, '<bdi>' + p.yearly + '</bdi> ' + t.perYear, t.save.replace('{n}', p.save))}
  </form>
  <div class="pay">
    ${env.STRIPE_SECRET_KEY ? `<button id="stripe" class="btn big wide" type="button">${ICONS.lock}<span>${t.payCard}</span></button>` : ''}
    ${paypal ? `<div class="or"><span>${t.or}</span></div><div id="paypal"></div>` : ''}
    ${!env.STRIPE_SECRET_KEY && !paypal ? `<p class="alert">${t.paySoon}</p>` : ''}
  </div>
  <p id="payError" class="alert" hidden></p>
  <ul class="buy-notes">${t.buyNotes.map(x => `<li>${ICONS.check}${x}</li>`).join('')}</ul>
</section>`;
  const config = { lang: lang, paypal: paypal, error: t.payError };
  const scripts = `<script>window.MAPLE_BUY=${JSON.stringify(config).replace(/</g, '\\u003c')};</script>
${paypal ? `<script src="https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(env.PAYPAL_CLIENT_ID)}&vault=true&intent=subscription&currency=${env.CURRENCY.toUpperCase()}" data-namespace="paypal"></script>` : ''}
<script src="/maple-iptv/assets/buy.js"></script>`;
  return html(layout(lang, t.buyTitle + ' — Maple IPTV', body, { path: '/buy', scripts: scripts }));
}

// After paying: the license code, and how to enter it in the app.
export function success(env, lang, code) {
  const t = T[lang];
  const body = code ? `
<section class="section narrow center">
  <div class="done-icon">${ICONS.check}</div>
  <h1>${t.successTitle}</h1>
  <p class="sub">${t.successSub}</p>
  <div class="license"><code id="code">${esc(code)}</code><button class="btn small" type="button" onclick="navigator.clipboard.writeText(document.getElementById('code').textContent);this.textContent='✓'">${t.copy}</button></div>
  <ol class="steps">${t.successSteps.map(x => `<li>${x}</li>`).join('')}</ol>
  <p class="note">${t.successKeep}</p>
  <a class="btn ghost" href="/maple-iptv/?lang=${lang}#devices">${t.navDownload}</a>
</section>` : `
<section class="section narrow center">
  <h1>${t.successPendingTitle}</h1>
  <p class="sub">${t.successPending}</p>
</section>`;
  return html(layout(lang, t.successTitle + ' — Maple IPTV', body, { path: '/success' }));
}

export function manage(env, lang) {
  const t = T[lang];
  const body = `
<section class="section narrow">
  <h1>${t.manageTitle}</h1>
  <p class="sub">${t.manageSub}</p>
  <form id="manage" class="manage">
    <input name="code" required placeholder="MPL-XXXX-XXXX-XXXX" dir="ltr" autocomplete="off">
    <button class="btn">${t.manageCheck}</button>
  </form>
  <div id="manageResult"></div>
</section>`;
  const scripts = `<script>window.MAPLE_MANAGE=${JSON.stringify({ t: t.manageJs }).replace(/</g, '\\u003c')};</script><script src="/maple-iptv/assets/manage.js"></script>`;
  return html(layout(lang, t.manageTitle + ' — Maple IPTV', body, { path: '/manage', scripts: scripts }));
}

export function legal(env, lang, which) {
  const t = T[lang];
  const doc = which === 'privacy' ? t.privacy : t.terms;
  const body = `<section class="section narrow legal"><h1>${doc.title}</h1><p class="note">${doc.updated}</p>
${doc.sections.map(s => `<h2>${s[0]}</h2>${s.slice(1).map(p => `<p>${p}</p>`).join('')}`).join('\n')}</section>`;
  return html(layout(lang, doc.title + ' — Maple IPTV', body, { path: '/' + which }));
}
