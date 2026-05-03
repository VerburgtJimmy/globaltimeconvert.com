-- Initial schema for globaltimeconvert.com
-- Applied via: npm run db:migrate:local  (or :remote)

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

CREATE TABLE timezones (
  id TEXT PRIMARY KEY,                 -- IANA id, e.g. 'America/New_York'
  abbr_standard TEXT,                  -- 'EST'
  abbr_dst TEXT,                       -- 'EDT'
  utc_offset_std_min INTEGER NOT NULL, -- offset from UTC in minutes (standard time)
  observes_dst INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE countries (
  code TEXT PRIMARY KEY,               -- ISO 3166-1 alpha-2
  name_en TEXT NOT NULL,
  continent TEXT NOT NULL
);

CREATE TABLE cities (
  id INTEGER PRIMARY KEY,              -- GeoNames ID
  slug TEXT UNIQUE NOT NULL,           -- 'new-york', 'paris-tx-us'
  name_en TEXT NOT NULL,
  ascii_name TEXT NOT NULL,
  country_code TEXT NOT NULL REFERENCES countries(code),
  admin1_code TEXT,                    -- state / province code
  population INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  timezone_id TEXT NOT NULL REFERENCES timezones(id),
  is_disambiguated INTEGER NOT NULL DEFAULT 0,
  prerender_priority INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_cities_slug ON cities(slug);
CREATE INDEX idx_cities_priority ON cities(prerender_priority DESC, population DESC);
CREATE INDEX idx_cities_search ON cities(ascii_name);

CREATE TABLE city_translations (
  city_id INTEGER NOT NULL REFERENCES cities(id),
  lang TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (city_id, lang)
);

-- ---------------------------------------------------------------------------
-- Analytics rollups
-- (raw events live in Workers Analytics Engine; cron rolls them into here)
-- ---------------------------------------------------------------------------

CREATE TABLE analytics_pages_daily (
  date TEXT NOT NULL,                  -- 'YYYY-MM-DD'
  path TEXT NOT NULL,
  lang TEXT NOT NULL,
  country TEXT,                        -- ISO-2 from CF-IPCountry; IP itself never stored
  pageviews INTEGER NOT NULL,
  unique_visitors INTEGER NOT NULL,    -- approx via daily-salted IP hash
  PRIMARY KEY (date, path, lang, country)
);

CREATE TABLE analytics_referrers_daily (
  date TEXT NOT NULL,
  referrer_domain TEXT NOT NULL,
  pageviews INTEGER NOT NULL,
  PRIMARY KEY (date, referrer_domain)
);

CREATE TABLE analytics_utm_daily (
  date TEXT NOT NULL,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  pageviews INTEGER NOT NULL,
  PRIMARY KEY (date, utm_source, utm_medium, utm_campaign)
);

CREATE TABLE analytics_searches_daily (
  date TEXT NOT NULL,
  query TEXT NOT NULL,
  count INTEGER NOT NULL,
  resulted_in_click INTEGER NOT NULL,
  PRIMARY KEY (date, query)
);

-- Daily-rotating salt for hashing visitor IPs. Salt itself never leaves D1
-- and is purged after 7 days, making prior-day visitor hashes unrecoverable.
CREATE TABLE analytics_salts (
  date TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);
