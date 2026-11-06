# سایت Maple IPTV (نسخه‌ی قدیمی Cloudflare — دیگر استفاده نمی‌شود)

> این نسخه کنار گذاشته شد. صفحه‌ها حالا داخل سایت اصلی (MapleOS) هستند. راهنمای جدید را در [`../WEBSITE.md`](../WEBSITE.md) ببینید. این پوشه فقط برای مرجع نگه داشته شده است.

آدرس: **https://mapleonlinesolutions.com/maple-iptv**. سایت فعلی شما (ASP.NET) دست نمی‌خورد. فقط آدرس‌هایی که با `/maple-iptv` شروع می‌شوند به این برنامه می‌رسند. این برنامه یک Cloudflare Worker است که روی همان دامنه اجرا می‌شود.

| صفحه | آدرس |
|---|---|
| معرفی محصول، امنیت، دانلود برای همه‌ی دستگاه‌ها، قیمت‌ها و سؤالات | `/maple-iptv/` (فارسی: `?lang=fa`) |
| خرید پلن ماهانه یا سالانه (Stripe و PayPal) | `/maple-iptv/buy` |
| مدیریت یا لغو اشتراک با کد | `/maple-iptv/manage` |
| حریم خصوصی و شرایط استفاده | `/maple-iptv/privacy` و `/maple-iptv/terms` |
| **پنل مدیریت** (فقط برای شما) | `/maple-iptv/admin` |

در پنل مدیریت این اطلاعات را می‌بینید:
- تعداد نصب‌ها و نصب‌های فعال.
- برای هر نصب: دستگاه، نسخه، تریال، کوپن، لایسنس یا خرید، یوزر و سرور IPTV، IP، شهر و کشور، و اولین و آخرین بار.
- لایسنس‌های فروخته‌شده و درآمد ماهانه.
- امکان باطل کردن کد، تمدید آن، یا ساختن کد هدیه.

## فایل‌ها

- `src/index.js`: مسیرها.
- `src/pages.js` و `src/text.js`: صفحه‌ها و همه‌ی متن‌ها (انگلیسی و فارسی).
- `src/api.js`: گزارش نصب از اپ، و بررسی کد.
- `src/stripe.js` و `src/paypal.js`: پرداخت.
- `src/admin.js` و `public/maple-iptv/assets/admin.*`: پنل مدیریت.
- `schema.sql`: جدول‌های دیتابیس.
- `public/maple-iptv/`: استایل، عکس‌ها، `coupons.json` و فایل‌های دانلود.
- قیمت‌ها و ارز در `wrangler.jsonc` هستند و به سنت نوشته می‌شوند: `PRICE_MONTHLY` = 399 یعنی 3.99 دلار.

## اجرای آزمایشی روی همین کامپیوتر

```bash
npm install
npx wrangler d1 execute maple-iptv --local --file schema.sql
npx wrangler dev
```

بعد `http://127.0.0.1:8787/maple-iptv/` را باز کنید. در حالت آزمایشی، فایل `.dev.vars` (که `DEV_ADMIN=1` دارد) پنل مدیریت را فقط از همین کامپیوتر باز می‌کند.

## راه‌اندازی (یک بار)

کارهایی که ورود به حساب یا وارد کردن کلید لازم دارند را **خودتان** انجام دهید. بقیه را من انجام می‌دهم.

### ۱. Cloudflare

1. دامنه‌ی `mapleonlinesolutions.com` باید روی Cloudflare باشد (پلن رایگان کافی است). اگر نیست، در Cloudflare «Add a site» را بزنید و Nameserverها را نزد ثبت‌کننده‌ی دامنه عوض کنید. رکوردهای DNS فعلی کپی می‌شوند و سایت فعلی کار می‌کند. رکورد دامنه‌ی اصلی باید **Proxied** (ابر نارنجی) باشد.
2. در همین پوشه:
   ```bash
   npx wrangler login
   npx wrangler d1 create maple-iptv
   ```
   `database_id` را که چاپ می‌شود در `wrangler.jsonc` بگذارید (یا به من بدهید).
3. ساخت جدول‌ها و انتشار:
   ```bash
   npx wrangler d1 execute maple-iptv --remote --file schema.sql
   npx wrangler deploy
   ```

### ۲. قفل پنل مدیریت (Cloudflare Access)

1. در Cloudflare به **Zero Trust ← Access ← Applications ← Add an application ← Self-hosted** بروید.
2. Domain را `mapleonlinesolutions.com` و Path را `maple-iptv/admin` بگذارید.
3. یک Policy از نوع Allow بسازید و فقط ایمیل خودتان را به آن بدهید (`info@mapleonlinesolutions.com`).
4. **Application Audience (AUD) Tag** و نام تیم (مثلاً `maple.cloudflareaccess.com`) را در `wrangler.jsonc` بگذارید: `ACCESS_AUD` و `ACCESS_TEAM_DOMAIN`.
5. دوباره `npx wrangler deploy` کنید.

نتیجه: پنل فقط بعد از ورود با ایمیل شما باز می‌شود. خود برنامه هم امضای Cloudflare را بررسی می‌کند.

### ۳. Stripe (کارت، Apple Pay، Google Pay)

1. حساب Stripe بسازید. نوع کسب‌وکار را «نرم‌افزار / اشتراک نرم‌افزار» بنویسید (پایین‌تر را ببینید).
2. از **Developers ← API keys**، کلید Secret را بردارید و این دستور را بزنید. کلید را خودتان وارد کنید:
   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY
   ```
3. در **Developers ← Webhooks ← Add endpoint**:
   - آدرس را `https://mapleonlinesolutions.com/maple-iptv/api/stripe/webhook` بگذارید.
   - این رویدادها را انتخاب کنید: `checkout.session.completed`، `customer.subscription.updated`، `customer.subscription.deleted` و `invoice.paid`.
   - Signing secret را با این دستور وارد کنید:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```
4. در **Settings ← Billing ← Customer portal**، پورتال را فعال کنید و «لغو اشتراک» و «تغییر کارت» را روشن کنید.
5. اول با کلیدهای تست (`sk_test_…`) و کارت `4242 4242 4242 4242` امتحان کنید. بعد کلیدهای Live را بگذارید.

### ۴. PayPal

1. در developer.paypal.com به **Apps & Credentials** بروید و یک App بسازید (اول Sandbox، بعد Live).
2. Client ID را در `wrangler.jsonc` بگذارید: `PAYPAL_CLIENT_ID`، و `PAYPAL_MODE` را `sandbox` یا `live` بگذارید. Secret را با این دستور وارد کنید:
   ```bash
   npx wrangler secret put PAYPAL_CLIENT_SECRET
   ```
3. در همان App یک Webhook بسازید:
   - آدرس را `https://mapleonlinesolutions.com/maple-iptv/api/paypal/webhook` بگذارید.
   - رویدادهای `BILLING.SUBSCRIPTION.*` و `PAYMENT.SALE.COMPLETED` را انتخاب کنید.
   - Webhook ID را در `PAYPAL_WEBHOOK_ID` بگذارید.
4. `npx wrangler deploy` کنید. بعد در پنل مدیریت دکمه‌ی **«ساخت پلن‌های PayPal»** را بزنید.

### ۵. فایل‌های دانلود

- اندروید (APK) و کیت مک در `public/maple-iptv/files/` هستند و با deploy منتشر می‌شوند.
- نصب‌کننده‌ی ویندوز حدود ۱۲۰ مگابایت است و از سقف ۲۵ مگابایت Worker بزرگ‌تر است. آن را در Cloudflare R2 یا GitHub Releases بگذارید و لینکش را در `DOWNLOAD_WINDOWS` بنویسید. تا آن موقع روی سایت «به‌زودی» نمایش داده می‌شود.
- نسخه‌ی جدید: فایل را جایگزین کنید و `npx wrangler deploy` بزنید.
- کوپن جدید (با `tools/coupons.js`): بعد از ساخت، `web/coupons.json` را در `public/maple-iptv/coupons.json` کپی کنید و deploy کنید. اپ‌ها فهرست جدید را از سایت می‌گیرند.

## نکته‌های مهم قبل از فروش

- **Stripe و PayPal و IPTV:** هر دو با کسب‌وکارهای مرتبط با IPTV سخت‌گیر هستند و ممکن است حساب را محدود کنند.
  - محصول را «نرم‌افزار پخش‌کننده‌ی رسانه» معرفی کنید. سایت هم صریحاً می‌گوید هیچ کانال یا محتوایی فروخته نمی‌شود.
  - هرگز در کنار اپ کانال یا اشتراک IPTV نفروشید.
- **گوگل‌پلی:** نسخه‌ی گوگل‌پلی اجازه ندارد کاربر را برای پرداخت به سایت بفرستد. اپ وقتی پرداخت گوگل‌پلی فعال باشد، دکمه‌ی خرید از سایت را نشان نمی‌دهد. وارد کردن کد همچنان کار می‌کند.
- **متن‌های حقوقی:** حریم خصوصی و شرایط استفاده (در `src/text.js`) پیش‌نویس هستند. در آن‌ها بازگشت وجه ۷ روزه است و قانون حاکم کانادا. لطفاً بازبینی کنید.
- **ارز:** دلار آمریکا. برای دلار کانادا، `CURRENCY` را `cad` کنید.
- **امضای APK:** فایل APK فعلی با کلید Debug امضا شده است. قبل از انتشار عمومی، یک کلید Release دائمی بسازیم و آن را برای همیشه نگه دارید. بدون آن کلید، نسخه‌های بعدی روی نسخه‌ی قبلی نصب نمی‌شوند.
- **اطلاعات:** اطلاعات نصب‌هایی که ۱۲ ماه دیده نشده‌اند هر شب خودکار پاک می‌شود. اپ رمز IPTV را هرگز نمی‌فرستد. گزارش نصب هم فقط بعد از اجازه‌ی کاربر فرستاده می‌شود.
