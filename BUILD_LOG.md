# WORLD PRESIDENT — Build Log

**Project:** WORLD PRESIDENT — "YOUR NATION. YOUR DECISIONS. OUR WORLD."
**Goal:** goal_5c6db204429b (multiplayer-nation-simulator-game)
**Built:** 2026-11-11. **Status:** COMPLETE + VERIFIED LOCALLY. **Not deployed** (deployment is the parent's job).
**Stack:** Node 24 + Express + Socket.io + bcryptjs + pg (Postgres only when `DATABASE_URL` is set).
Local store: SQLite via `node:sqlite` (`world.db`). No Redis. No paid services.

## How to run locally

```bash
cd ~/workspace/world-president/server
npm install
npm start          # serves game on http://localhost:3000 (PORT env overrides)
npm test           # smoke test (32 checks, boots its own temp server+DB)
```

Open http://localhost:3000 → register → pick a country → play.
First registered user becomes admin.

## What was built, per spec phase

- **Phase 1 — Auth, countries, world:** register/login (bcrypt + opaque 30-day Bearer tokens),
  player profiles, 40 playable countries seeded with 2026-approx stats (population, GDP, treasury,
  debt, reserves, resources, production/consumption, climate risk, neighbours), one president per
  country, persistent shared world, server-authoritative tick (1 tick = 1 game day, default 60s,
  `TICK_SECONDS` env, catch-up on boot capped at 240).
- **Phase 2 — Dashboard:** all §13 stats + live Chart.js charts (treasury/GDP, approval history).
- **Phase 3 — Economy:** 21 commodities, dynamic prices from supply/demand ± noise (labelled
  "Simulated market — not real-world data"), market buy/sell, player-to-player trade offers,
  tariffs (via policy), trade agreements, embargoes, taxes, national budget, inflation/unemployment.
- **Phase 4 — Population/health/disasters:** demographics (birth/death, age bands, urban/rural,
  literacy, poverty, migration), hospitals/doctors/beds/vaccination, disease outbreaks with
  progression, disaster/event engine (risk-weighted by each country's climate profile, severity 1–3),
  emergency responses (emergency fund / ignore / international appeal).
- **Phase 5 — Diplomacy:** relations score, embassies, alliances (two-sided accept), treaties,
  embargoes, diplomatic DMs, UN-style resolutions with votes closing at >50% of claimed countries.
- **Phase 6 — Map/news/multiplayer:** Leaflet world map (GeoJSON via CDN, country-list fallback),
  click country → profile; news generated ONLY from real in-game events; live notifications;
  global + country + DM chat; rankings (GDP, quality of life, education, health, infra, influence,
  green); online presence via Socket.io.
- **Phase 7 — Advisors/admin/security/deploy:** rule-based AI advisors (economy/priorities/
  diplomacy/risks — explain only, never decide); achievements; admin panel (overview, broadcast,
  ban/unban, reset country, tick speed); anti-cheat = server-side validation of every action
  (ownership, treasury, stockpiles, ranges, embargoes), rate limits (600 req/min/IP + per-action
  cooldowns), audit log; `Dockerfile` + `railway.json` + `.env.example` + `README.md` deploy docs.

## Verification evidence (2026-11-11, coordinator re-ran independently)

`npm test` — **ALL PASS (32 checks, exit 0)**, including the login-after-restart regression test.
Live run on port 3100 (temp DB), real end-to-end flow:
- Register A (admin=true) + B → claim PK + IN → dashboard loads
  (PK: pop 255,000,000, GDP $390B, treasury $8,500M, approval 58, tax 15%).
- Market buy oil ×100 → treasury deducted ($8,500 → $8,499.99M).
- Admin forced tick → game date 2026-01-02, treasury $8,421.46M, GDP $390.03B,
  population +7,707; news generated: "Heatwave strikes Pakistan", fertilizer/copper price surges.
- Trade offer PK→IN wheat ×500 @ $250 accepted → total $0.125M, buyer stockpile increased.
- Advisors return 4 sections; rankings 7 categories (GDP top = US); chat message stored.
- **Restart persistence:** server stopped + restarted on same DB → fresh login works,
  treasury $8,421.58M / population / GDP exactly persisted, tick=1, gameDate 2026-01-02.
- **Two-client Socket.io:** smoke test — client2 receives client1's global chat message.
- Frontend serving verified: `/` 200, `/js/app.js` 200, `/data/i18n.json` 200, `/data/countries.json` 200.

## Bugs found & fixed during integration

1. **Login broke after restart (critical, fixed):** `normalizeUser()` in `server/src/store.js`
   stripped `password_hash`, so `bcrypt.compare(password, undefined)` threw and every fresh login
   after a restart returned 500 "Login failed". The smoke test had never logged in after a
   restart (it reused the register token), so it missed this. Fixed by keeping `password_hash`
   in the internal normalized user (it never leaves the server — API responses go through
   `publicUser()` which whitelists fields). Added regression checks to `server/test/smoke.js`:
   "login works after restart" + "wrong password rejected".
2. **Integration fix:** backend served only `public/`; frontend's `i18n.js` fetches
   `data/i18n.json`. Added `app.use('/data', express.static(...))` (read-only JSON).
3. **Seed stockpiles vs cap (fixed by backend agent during testing):** seed stockpiles could
   hit the stockpile cap and block trade acceptance; now seeded at ≤50% of cap.

## Deliberate contract deviations (minor)

- Added `GET /api/health`, `GET /api/me/notifications`, admin-only `POST /api/admin/tick`.
- `GET /api/market` returns `{label, items}` so the "Simulated" label travels with the data.
- Stockpile cap = 2,000,000 + infraIndex×10,000 units/commodity (spec gave no number).
- Fixed server-side prices: tanks $5M, jets $40M, ships $120M, recruit $0.02M/soldier,
  vaccinate $50M, peacekeeping $100M, embassy $20M, improve-relations $5M.
- Dashboard chart history is client-side only (localStorage); the API has no history endpoint.
- Map GeoJSON loads from `raw.githubusercontent.com` at runtime; a country-list grid fallback
  covers offline/CDN failure.

## What remains / blocked

1. **Supabase project (BLOCKED on Nisar):** production Postgres needs a free Supabase project
   created from his account + its connection string as Railway `DATABASE_URL`. The Postgres path
   is implemented (`pg`, schema auto-created) but has NOT been tested against a live Supabase
   instance — first hosted deploy must be smoke-checked. Until then the app runs on local SQLite.
2. **Deployment (parent's job):** Railway deploy per `README.md` (Dockerfile builder,
   `railway.json` healthcheck `/api/health`). No deploy has been attempted.
3. **Scale honesty:** the architecture supports many concurrent players in principle, but
   "thousands simultaneous" has NOT been load-tested; free-tier Railway + Supabase will cap
   real concurrency well below that. Do not promise thousands until load-tested.
4. **No real-money/payments, no real-world data:** all prices/stats are simulated and labelled.
5. **First admin:** whoever registers first on the live deployment becomes admin — Nisar should
   register first.
