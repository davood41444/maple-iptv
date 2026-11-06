-- Maple IPTV website database (Cloudflare D1).
--   npx wrangler d1 execute maple-iptv --remote --file schema.sql

-- One row per app installation, updated each time the app reports in.
CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,          -- random id the app makes on first start
  platform TEXT,                -- android-tv | android | tizen | windows | mac | …
  device TEXT,                  -- model, e.g. "Sony BRAVIA 4K UR3"
  os TEXT,
  app_version TEXT,
  lang TEXT,
  status TEXT,                  -- trial | coupon | license | subscription | free | unlimited
  trial_days INTEGER,
  coupon TEXT,                  -- coupon code in use
  license_code TEXT,            -- website license in use
  iptv_type TEXT,               -- xtream | m3u
  iptv_user TEXT,               -- Xtream username (never the password)
  iptv_host TEXT,               -- playlist server's host name
  ip TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  timezone TEXT,
  first_seen INTEGER,           -- ms since 1970
  last_seen INTEGER,
  pings INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS installs_last_seen ON installs (last_seen);

-- Premium bought on the website (Stripe or PayPal subscription) or given by hand.
CREATE TABLE IF NOT EXISTS licenses (
  code TEXT PRIMARY KEY,        -- MPL-XXXX-XXXX-XXXX, entered in the app
  email TEXT,
  plan TEXT,                    -- monthly | yearly | manual
  provider TEXT,                -- stripe | paypal | manual
  provider_ref TEXT UNIQUE,     -- Stripe/PayPal subscription id
  customer_ref TEXT,            -- Stripe customer id
  status TEXT,                  -- active | past_due | canceled | revoked
  period_end INTEGER,           -- paid until (ms)
  created_at INTEGER,
  updated_at INTEGER,
  note TEXT
);
CREATE INDEX IF NOT EXISTS licenses_email ON licenses (email);

-- Small settings kept by the site itself (e.g. the PayPal plan ids it created).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
