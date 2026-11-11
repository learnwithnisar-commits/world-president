-- WORLD PRESIDENT schema. Postgres flavour; store.js translates it for SQLite
-- (SERIAL -> INTEGER PRIMARY KEY AUTOINCREMENT, JSONB -> TEXT, TIMESTAMPTZ -> TEXT).
-- All timestamps are ISO-8601 strings supplied by the app. No DB-side defaults
-- for timestamps so the same file works on both backends.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  banned BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS countries (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ur TEXT,
  capital TEXT,
  flag TEXT,
  region TEXT,
  government TEXT,
  currency TEXT,
  currency_symbol TEXT,
  lat REAL,
  lng REAL,
  base_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS country_state (
  code TEXT PRIMARY KEY,
  president_user_id INTEGER,
  state_json TEXT NOT NULL,
  treasury REAL DEFAULT 0,
  gdp REAL DEFAULT 0,
  population BIGINT DEFAULT 0,
  approval REAL DEFAULT 50,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS market_prices (
  commodity TEXT PRIMARY KEY,
  price REAL NOT NULL,
  prev_price REAL NOT NULL,
  supply REAL DEFAULT 0,
  demand REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trades (
  id SERIAL PRIMARY KEY,
  tick INTEGER DEFAULT 0,
  seller_code TEXT,
  buyer_code TEXT,
  commodity TEXT NOT NULL,
  qty REAL NOT NULL,
  price_per_unit REAL NOT NULL,
  total REAL NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS offers (
  id SERIAL PRIMARY KEY,
  from_code TEXT NOT NULL,
  to_code TEXT NOT NULL,
  commodity TEXT NOT NULL,
  qty REAL NOT NULL,
  price_per_unit REAL NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS relations (
  id SERIAL PRIMARY KEY,
  a_code TEXT NOT NULL,
  b_code TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  embassy BOOLEAN DEFAULT FALSE,
  alliance TEXT DEFAULT 'none',
  treaty TEXT,
  embargo BOOLEAN DEFAULT FALSE,
  updated_at TEXT NOT NULL,
  UNIQUE (a_code, b_code)
);

CREATE TABLE IF NOT EXISTS treaties (
  id SERIAL PRIMARY KEY,
  a_code TEXT NOT NULL,
  b_code TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS un_resolutions (
  id SERIAL PRIMARY KEY,
  proposer_code TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  votes_for INTEGER DEFAULT 0,
  votes_against INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS un_votes (
  id SERIAL PRIMARY KEY,
  resolution_id INTEGER NOT NULL,
  country_code TEXT NOT NULL,
  vote TEXT NOT NULL,
  UNIQUE (resolution_id, country_code)
);

CREATE TABLE IF NOT EXISTS news (
  id SERIAL PRIMARY KEY,
  tick INTEGER DEFAULT 0,
  game_date TEXT,
  category TEXT,
  title TEXT NOT NULL,
  body TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat (
  id SERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  user_id INTEGER,
  username TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  kind TEXT,
  read BOOLEAN DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS achievements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  unlocked_at TEXT NOT NULL,
  UNIQUE (user_id, code)
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  country_code TEXT NOT NULL,
  template_id TEXT NOT NULL,
  name TEXT NOT NULL,
  severity INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',
  tick INTEGER DEFAULT 0,
  data_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ministers (
  id SERIAL PRIMARY KEY,
  country_code TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (country_code, role)
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  country_code TEXT NOT NULL,
  project TEXT NOT NULL,
  status TEXT DEFAULT 'in_progress',
  started_tick INTEGER DEFAULT 0,
  completes_tick INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  from_code TEXT NOT NULL,
  to_code TEXT NOT NULL,
  from_user TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  payload TEXT,
  tick INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
