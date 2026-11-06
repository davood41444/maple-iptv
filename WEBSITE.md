# سایت Maple IPTV (داخل سایت اصلی MapleOS)

صفحه‌های Maple IPTV حالا بخشی از سایت اصلی شما، یعنی پروژه‌ی **MapleOS**، هستند:

- **آدرس:** `https://mapleonlinesolutions.com/maple-iptv`
- **ظاهر:** طراحی تیره‌ی جداگانه‌ی خودش را دارد.
- **دیتابیس و پنل ادمین:** همان دیتابیس و پنل ادمین سایت اصلی.
- **پرداخت:** همان Stripe سایت اصلی.
- **آدرس‌ها:** همان آدرس‌هایی است که اپ‌ها از قبل می‌شناسند. پس لازم نیست اپ‌ها را دوباره بسازید یا نصب کنید.

> پوشه‌ی `site/` (نسخه‌ی Cloudflare Worker) دیگر استفاده نمی‌شود. فقط برای مرجع نگه داشته شده است.

## صفحه‌ها

| صفحه | آدرس |
|---|---|
| معرفی، امنیت، دانلود، قیمت‌ها، سؤالات | `/maple-iptv/` (فارسی: `?lang=fa`) |
| خرید ماهانه یا سالانه (Stripe و PayPal) | `/maple-iptv/buy` |
| مدیریت یا لغو اشتراک با کد | `/maple-iptv/manage` |
| حریم خصوصی و شرایط استفاده | `/maple-iptv/privacy` و `/maple-iptv/terms` |
| **مدیریت نصب‌ها و لایسنس‌ها** | پنل ادمین ← **Maple IPTV** (منوی کناری) |
| **کلیدها، قیمت‌ها و لینک‌ها** | پنل ادمین ← **Settings** ← بخش **Maple IPTV** |

## چه چیزهایی در MapleOS اضافه شد

| فایل | کار |
|---|---|
| `Domain/Entities/IptvInstall.cs`، `IptvLicense.cs` و `IptvLicenseDevice.cs` | جدول نصب‌ها، لایسنس‌ها و دستگاه‌های هر لایسنس |
| `Infrastructure/Migrations/…_AddMapleIptv.cs` و `…_AddMapleIptvDevices.cs` | ساخت همین جدول‌ها، و هیچ تغییر دیگری در دیتابیس |
| `Infrastructure/Services/MapleIptv/` | لایسنس‌ها، گزارش نصب، Stripe، PayPal و تنظیمات |
| `Web/Controllers/MapleIptvController.cs` و `MapleIptvApiController.cs` | صفحه‌ها، API اپ، و Webhookها |
| `Web/Views/MapleIptv/` و `Web/Resources/MapleIptvText.json` | صفحه‌ها و متن‌های انگلیسی و فارسی |
| `Web/Areas/Admin/…/MapleIptv` | بخش Maple IPTV در پنل ادمین |
| `Web/wwwroot/maple-iptv/` | استایل، عکس‌ها، `coupons.json`، و فایل‌های دانلود اندروید، ویندوز و مک (نسخه‌ی ۱.۱.۱) |

فایل‌های موجود فقط در این چند جا کمی تغییر کرده‌اند:

- `AppDbContext.cs`: دو جدول جدید.
- `DependencyInjection.cs`: ثبت سرویس‌ها.
- `DbSeeder.cs`: ردیف‌های تنظیمات Maple IPTV.
- `Program.cs`: یک کار شبانه که نصب‌های یک سال غیرفعال را پاک می‌کند.
- `_Layout.cshtml`: لینک منوی ادمین.
- صفحه‌ی Settings: مخفی ماندن کلیدهای مخفی.
- `MapleOS.Web.csproj`: فایل متن‌ها.

از کل پروژه‌ی قبل از تغییرات یک نسخه‌ی پشتیبان در `Desktop\Projects\MapleOS-backup-2026-10-30` هست.

## سقف ۳ دستگاه برای هر کد

- **چطور کار می‌کند:** هر کد Premium هم‌زمان روی حداکثر **۳ دستگاه** کار می‌کند.
  - اپ (از نسخه‌ی ۱.۱.۱) هنگام بررسی کد، شناسه‌ی تصادفی نصب و نوع دستگاه را هم می‌فرستد.
  - دستگاه چهارم پیام «این کد روی ۳ دستگاه در حال استفاده است» می‌گیرد.
- **عوض کردن دستگاه:** خریدار در صفحه‌ی **مدیریت اشتراک** دستگاه‌هایش را می‌بیند و می‌تواند **ماهی یک بار** همه را آزاد کند. دستگاه‌هایی که هنوز استفاده می‌کند، دفعه‌ی بعد که اپ را باز کنند خودکار جایشان را پس می‌گیرند.
- **دستگاه‌های غیرفعال:** دستگاهی که ۴۵ روز کد را بررسی نکند، دیگر جا نمی‌گیرد.
- **در پنل ادمین:** در صفحه‌ی Licenses، ستون Devices تعداد و نام دستگاه‌ها را نشان می‌دهد. دکمه‌ی آزاد کردن دستگاه‌ها برای شما محدودیت ماهانه ندارد.
- **اگر کد پخش شده باشد:** برای قطع کامل، کد را **Revoke** کنید.
- **تغییر عدد ۳:** در `iptv.max_devices`. در این صورت عدد ۳ را در متن‌های سایت (`MapleIptvText.json`) و پیام اپ هم عوض کنید.

## انتشار (هر بار که چیزی عوض شد)

1. در پنل site4now، **از دیتابیس یک Backup بگیرید.** این فقط یک احتیاط است. بار اول که سایت جدید بالا می‌آید، جدول‌های تازه خودکار ساخته می‌شوند و به جدول‌های فعلی دست نمی‌زنند.
   - نصب‌کننده‌ی ویندوز (حدود ۱۲۰ مگابایت) هم جزو فایل‌های سایت است. پس آپلود بزرگ‌تر از قبل می‌شود. فضای خالی هاست را هم چک کنید.
2. در Visual Studio، پروژه‌ی MapleOS.Web را مثل همیشه **Publish** کنید.
   - **مهم:** خروجی را در یک **پوشه‌ی خالی** بگیرید.
   - پوشه‌ی فعلی `Desktop\Publish` فایل‌های پروژه‌ی دیگری (Ymca) را دارد.
3. فایل‌ها را مثل همیشه روی site4now بفرستید.
4. صفحه‌ی `https://mapleonlinesolutions.com/maple-iptv/?lang=fa` را باز کنید.

## راه‌اندازی پرداخت (یک بار)

### Stripe

Stripe از همان کلیدهای سایت اصلی استفاده می‌کند. فقط یک Webhook جدا لازم است:

1. در Stripe به **Developers ← Webhooks ← Add endpoint** بروید.
2. آدرس را `https://mapleonlinesolutions.com/maple-iptv/api/stripe/webhook` بگذارید.
3. این رویدادها را انتخاب کنید:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
4. **Signing secret** (که با `whsec_` شروع می‌شود) را در پنل ادمین ← Settings ← `iptv.stripe_webhook_secret` بگذارید و Save بزنید.
5. در Stripe به **Settings ← Billing ← Customer portal** بروید و «لغو اشتراک» و «تغییر کارت» را روشن کنید.

اگر خواستید IPTV حساب Stripe جداگانه داشته باشد (پیشنهاد من، پایین‌تر را ببینید):

- کلید Secret آن حساب را در `iptv.stripe_secret_key` بگذارید.
- Webhook بالا را در **همان حساب** بسازید.

### PayPal

1. در developer.paypal.com به **Apps & Credentials** بروید و یک App بسازید. اول Sandbox، بعد Live.
2. **Client ID** و **Secret** را در Settings بگذارید: `iptv.paypal_client_id` و `iptv.paypal_client_secret`.
3. `iptv.paypal_mode` را `sandbox` (آزمایشی) یا `live` بگذارید.
4. در همان App یک Webhook بسازید:
   - آدرس: `https://mapleonlinesolutions.com/maple-iptv/api/paypal/webhook`
   - رویدادها: `BILLING.SUBSCRIPTION.*` و `PAYMENT.SALE.COMPLETED`
   - **Webhook ID** را در `iptv.paypal_webhook_id` بگذارید.
5. در پنل ادمین ← Maple IPTV، دکمه‌ی **Create the PayPal monthly and yearly plans** را بزنید.

### بقیه

- **شهر کاربر:** کشور کاربر خودکار ثبت می‌شود. برای شهر:
  1. وارد حساب Cloudflare‌ای شوید که دامنه در آن است.
  2. به **Rules ← Transform Rules ← Managed Transforms** بروید.
  3. **Add visitor location headers** را روشن کنید.
- **ویندوز:** نصب‌کننده در `wwwroot\maple-iptv\files\MapleIPTV-Setup.exe` است و مستقیم از سایت دانلود می‌شود. اگر فضای هاست کم بود، فایل را حذف کنید، آن را جای دیگری بگذارید (مثلاً GitHub Releases) و لینک `https://…` را در `iptv.download_windows` بنویسید.
- **قیمت‌ها:** در `iptv.price_monthly`، `iptv.price_yearly` و `iptv.currency`. بعد از تغییر قیمت، دکمه‌ی ساخت دوباره‌ی پلن‌های PayPal را بزنید.
- **نسخه‌ی جدید اپ:** فایل را در `MapleOS.Web\wwwroot\maple-iptv\files\` جایگزین کنید و Publish کنید.
- **کوپن جدید:** بعد از `tools/coupons.js`، فایل `web/coupons.json` را در `wwwroot\maple-iptv\coupons.json` کپی کنید و Publish کنید.

## نکته‌های مهم

- **Stripe مشترک:** اگر Stripe روزی IPTV را مشکوک بداند، ممکن است کل حساب را محدود کند. آن وقت پرداخت مشتری‌های اصلی‌تان هم متوقف می‌شود.
  - پیشنهاد من: در Stripe با همان ایمیل یک **حساب جداگانه** (New account) برای Maple IPTV بسازید و کلیدش را در `iptv.stripe_secret_key` بگذارید.
  - محصول را همیشه «نرم‌افزار پخش‌کننده‌ی رسانه» معرفی کنید و هرگز کانال یا اشتراک IPTV نفروشید.
- **دیتابیس اصلی:** تنظیمات MapleOS، حتی روی کامپیوتر خودتان، به **دیتابیس اصلی سایت** وصل است. اجرای پروژه روی کامپیوتر یعنی کار روی دیتابیس واقعی.
  - هر بار که پروژه را در Visual Studio اجرا کنید، جدول‌های تازه‌ی IPTV همان لحظه در دیتابیس واقعی ساخته می‌شوند. ضرری ندارد، چون همان کاری است که انتشار هم انجام می‌دهد.
- **متن‌های حقوقی:** این متن‌ها پیش‌نویس هستند و باید بازبینی شوند. در فایل `MapleOS.Web\Resources\MapleIptvText.json` قرار دارند.
- **اطلاعات کاربران:** اپ رمز IPTV را هرگز نمی‌فرستد و گزارش فقط با اجازه‌ی کاربر فرستاده می‌شود. نصب‌هایی که یک سال دیده نشده‌اند هر شب خودکار پاک می‌شوند.
