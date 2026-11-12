# WORLD PRESIDENT — Your Nation. Your Decisions. Our World.

A browser-based multiplayer nation simulator. Register, become president of a
country, and run it in a persistent shared world: economy, live simulated
commodity markets, trade, population, healthcare, military, diplomacy, the UN,
disasters, news, chat, rankings and achievements — all server-authoritative.

> All market prices and economic figures are **simulated game data, not
> real-world data**. News is generated only from real in-game occurrences.

## Layout

```
world-president/
  server/        backend (this README's area): Node 24 + Express + Socket.io
    src/         server.js, store.js, sim.js, seed.js, advisors.js, schema.sql
    test/        smoke.js (npm test)
    Dockerfile, railway.json, .env.example
  data/          countries.json, commodities.json, events.json, i18n.json
  public/        frontend (index.html, css/, js/)
  world.db       local SQLite database (created on first boot)
```

## Local run

```bash
cd ~/workspace/world-president/server
npm install
npm start        # server on http://localhost:3000 (PORT env to change)
```

First boot seeds the database from `data/*.json` (40 countries, 21
commodities, event templates). If the data files are not present yet, a
built-in 5-country fallback seed is used so the server still boots.
Seeding is idempotent — it skips when countries already exist.

```bash
npm test         # smoke test: register/claim/policy/market/trade/tick/
                 # restart-persistence + 2 Socket.io clients chatting
```

Environment variables (see `server/.env.example`):

| Var | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `TICK_SECONDS` | `60` | Seconds per game day (tick); admin can change live, 10–600 |
| `DATABASE_URL` | _(unset)_ | Set to use Postgres (Supabase); unset = local SQLite `world.db` |
| `DB_PATH` | `./world.db` | SQLite file override (only when `DATABASE_URL` is unset) |

## API

Auth: `Authorization: Bearer <token>` (30-day opaque session tokens, bcrypt
passwords). The first registered user becomes admin.

Key endpoints (full contract in `ARCHITECTURE.md`):

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/countries`, `POST /api/countries/claim`, `GET /api/world`
- `GET /api/me/country`, `GET /api/countries/:code`
- `GET /api/market`, `POST /api/market/buy`, `POST /api/market/sell`
- `GET /api/trade/offers`, `POST /api/trade/offer`, `POST /api/trade/respond`
- `POST /api/actions/policy|build|appoint|respond-event`, `GET /api/actions/projects|ministers`
- `GET /api/population`, `GET /api/health`, `POST /api/health/vaccinate`
- `GET /api/military`, `POST /api/military/recruit|equipment|peacekeeping`
- `GET /api/diplomacy`, `POST /api/diplomacy/relation|message`, `GET /api/diplomacy/messages/:code`
- `GET /api/un`, `POST /api/un/propose|vote`
- `GET /api/news`, `GET /api/rankings`, `GET|POST /api/chat`, `GET /api/advisors`, `GET /api/achievements`
- `GET /api/admin/overview`, `POST /api/admin/broadcast|moderate|speed|tick` (admin only)

Socket.io: connect with `auth: {token}`. Server emits `world:update` every
tick, `news:new`, `chat:message`, `notify`, `presence`. Client emits
`chat:send {channel, text}` (`global`, `country:<CODE>`, `dm:<CODE>`).

Simulation: one tick = one game day. Revenue/expenses, GDP and population
drift, stockpiles, commodity prices (supply/demand + noise), random events
weighted by each country's climate risk, project completion, disease
progression and achievement checks. On boot, catch-up ticks run for elapsed
time (capped at 240). All state lives in the store — a restart restores
everything.

## Deploy to Railway + Supabase (free)

1. **Supabase** (free tier): create a project at https://supabase.com →
   Project Settings → Database → copy the **Connection string** (URI).
   Use the direct (port 5432) string, not the pooler, or the pooler string
   with `?sslmode=require`. No tables to create by hand — the server runs
   `server/src/schema.sql` (`CREATE TABLE IF NOT EXISTS`) on boot.
2. **Railway**: create a project from this repo (existing Railway account).
   Add a service from the repo; Railway detects `server/railway.json` and
   builds `server/Dockerfile` (build context = repo root).
3. Set service variables: `DATABASE_URL=<Supabase connection string>`,
   `TICK_SECONDS=60`. `PORT` is provided by Railway automatically.
4. Deploy. Health check: `GET /api/health` → `{"status":"ok",...}`.
5. Open the Railway public URL — the server also serves `public/` statically.

Notes:

- The same code runs locally on SQLite (no `DATABASE_URL`) and hosted on
  Postgres — `server/src/store.js` abstracts both with identical methods.
- Never commit a real `.env` or a `DATABASE_URL` with a password.
- The first user to register on the live deployment becomes admin.

Deploy note (2026-11-12): Railway auto-deploy missed the Dockerfile-layout fix commits; this commit re-triggers deployment from the current main tip.
