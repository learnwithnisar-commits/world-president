# WORLD PRESIDENT — Architecture & API Contract (AUTHORITY for all builders)

Project dir: `~/workspace/world-president/`
Stack: Node 24 + Express + Socket.io + bcryptjs + pg (only when DATABASE_URL set).
No Redis. Deps pinned in `server/package.json`. Zero paid services.

## Layout (disjoint ownership — do not touch another agent's area)
- `server/` — BACKEND agent: package.json, src/*.js, Dockerfile, railway.json, .env.example
- `data/` — DATA agent: countries.json, commodities.json, events.json, i18n.json
- `public/` — FRONTEND agent: index.html, css/app.css, js/app.js (+ js/i18n.js loads data/i18n.json)
- Root: README.md (BACKEND agent), BUILD_LOG.md (coordinator)

## Store abstraction (BACKEND)
`server/src/store.js` exports `createStore()` returning an object with async methods.
- If `process.env.DATABASE_URL` is set → Postgres via `pg` Pool (Supabase connection string).
  Tables are created by `server/src/schema.sql` (run on boot with CREATE TABLE IF NOT EXISTS).
- Else → local SQLite via `node:sqlite` (`DatabaseSync`), file `~/workspace/world-president/world.db`.
- Same method names/signatures in both backends. Tables: users, countries, country_state (one row
  per country, JSON blob + indexed columns), market_prices, trades, offers, relations, treaties,
  un_resolutions, un_votes, news, chat, notifications, achievements, events, ministers, projects,
  sessions, game_meta (tick, gameDate, speed).
- IMPORTANT: all game state lives in the store; restart must restore everything (no in-memory state
  except Socket.io connections + a cached tick timer).

## Auth
- bcryptjs password hashing. Opaque session tokens: 32 random bytes, hex, stored in `sessions`
  with user_id + expires_at (30 days). Header: `Authorization: Bearer <token>`.
- First registered user becomes admin (`is_admin=true`). Admin endpoints check it server-side.

## Simulation (server-authoritative)
- One tick = 1 game day. Default `TICK_SECONDS=60` (env-configurable; admin can change speed).
- Tick runs on an interval; on boot, run catch-up ticks for elapsed time (cap 240 ticks).
- Each tick, for every country: tax revenue = gdp * taxRate / 365; expenses (health, education,
  defense, infra maintenance, debt interest); treasury += revenue - expenses; GDP grows by
  growthRate (base + education/infra/health bonuses - tax drag - event effects); population grows
  by birth-death + migration; unemployment/approval drift toward targets set by policy;
  production/consumption update stockpiles per commodity; market prices move:
  `price *= 1 + clamp((demand-supply)/supply * 0.02 + noise*0.01, -0.05, 0.05)`.
- Events: each tick, small chance per country of a disaster/disease/economic event, severity 1-3,
  weighted by that country's risk profile in countries.json. Event creates a news item + a
  pending event the president can respond to (spend emergency budget → reduce damage).
- News items are created ONLY from real game occurrences (tick events, trades, treaties, wars,
  elections, construction completion). Never fabricate player actions.
- All money in USD millions in the API unless stated. GDP in USD billions.

## REST API (all JSON; auth required except register/login/world-summary/news/rankings)
- POST /api/auth/register {username, email, password} → {token, user:{id,username,email,is_admin}}
- POST /api/auth/login {username|email, password} → same
- GET  /api/auth/me → {user, countryCode|null}
- GET  /api/countries → [{code,name,capital,flag,region,government,population,gdp,president:null|username,claimed}]
- POST /api/countries/claim {code} → claims an unclaimed country for the logged-in user (one only)
- GET  /api/world → {tick, gameDate, speed, onlineCount, prices:{commodity:price}, topNews:[...]}
- GET  /api/me/country → full state of my country (see state shape below)
- GET  /api/countries/:code → public profile of a country (state + president + relations summary)
- GET  /api/market → [{commodity, price, prevPrice, changePct, supply, demand}] (label: simulated)
- POST /api/market/buy {commodity, qty} → server validates treasury + stockpile capacity, updates both countries' stockpiles/treasury, creates trade record + news if large
- POST /api/market/sell {commodity, qty} → same, reverse
- GET  /api/trade/offers → offers involving my country (in/out)
- POST /api/trade/offer {toCode, commodity, qty, pricePerUnit} → creates pending offer
- POST /api/trade/respond {offerId, accept:boolean} → executes or rejects (server validates both sides)
- POST /api/actions/policy {taxRate?, healthBudget?, educationBudget?, defenseBudget?, interestRate?} → validates ranges, applies, returns new state
- POST /api/actions/build {project} → project ∈ roads, railways, airports, seaports, hospitals, schools, universities, power, renewables, water, factories, farms, research, housing, digital. Cost in treasury + commodity cost (steel, timber, etc.); completes after N ticks; boosts relevant index.
- GET  /api/actions/projects → my in-progress/completed projects
- POST /api/actions/appoint {role, name} → role ∈ foreign, finance, defense, health, education, interior. Replaces minister; small approval effect.
- GET  /api/actions/ministers → my ministers
- POST /api/actions/respond-event {eventId, response} → response ∈ emergency_fund|ignore|international_appeal. Server applies effects.
- GET  /api/population → my country's demographics (pop, birth/death, age bands, urban/rural, literacy, poverty, migration)
- GET  /api/health → hospitals, doctors, beds, vaccination, active diseases [{name, affected, severity, trend}]
- POST /api/health/vaccinate {disease} → spend treasury, reduce affected
- GET  /api/military → personnel, equipment {tanks, jets, ships}, readiness, defense budget
- POST /api/military/recruit {count} / /api/military/equipment {item, qty}
- POST /api/military/peacekeeping {targetCode} → sends mission, improves relations + influence
- GET  /api/diplomacy → {relations:[{code, score, embassy, alliance, treaty, embargo}], pendingOffers}
- POST /api/diplomacy/relation {toCode, action} → action ∈ improve, embassy, alliance_propose, alliance_accept, treaty, embargo, embargo_lift, break. Alliance/treaty require the other side to accept (creates pending item; other president accepts via same endpoint with accept:true).
- POST /api/diplomacy/message {toCode, text} → diplomatic DM (stored, delivered via socket)
- GET  /api/diplomacy/messages/:code → thread with that country
- GET  /api/un → resolutions [{id, proposer, text, votesFor, votesAgainst, status}]
- POST /api/un/propose {text} → creates resolution
- POST /api/un/vote {id, vote:'for'|'against'} → one vote per country; closes at >50% of claimed countries
- GET  /api/news?limit=50 → [{id, tick, gameDate, category, title, body}]
- GET  /api/rankings → {gdp:[...], qualityOfLife:[...], education:[...], health:[...], infra:[...], influence:[...], green:[...]} (top 10 each, code+value)
- GET  /api/chat/:channel → channel ∈ global | country:<code> | dm:<code>. Last 100 messages.
- POST /api/chat {channel, text} → validates length ≤500, rate limit 1 msg / 2s per user
- GET  /api/advisors → rule-based briefing: {economy:[...strings], priorities:[...], diplomacy:[...], risks:[...]} computed from live state. Advisors NEVER change state.
- GET  /api/achievements → my unlocked achievements + progress
- GET  /api/admin/overview → admin only: users, countries, recent actions, online users
- POST /api/admin/broadcast {text} → admin only
- POST /api/admin/moderate {userId, action:'ban'|'unban'|'reset_country'} → admin only
- POST /api/admin/speed {seconds} → admin only, sets tick seconds (10..600)

## Country state shape (GET /api/me/country and /api/countries/:code)
```
{code,name,capital,flag,region,government,currency,president,
 population, gdp, gdpPerCapita, treasury, debt, reserves,
 taxRate, inflation, unemployment, approval, literacy, poverty,
 healthIndex, educationIndex, infraIndex, energy, energyGreenPct,
 defenseBudget, personnel, readiness,
 imports, exports, tradeBalance,
 stockpiles:{oil:.., wheat:..}, ministers:{...}, projects:[...],
 events:[pending...], diseases:[...], relationsSummary, achievements}
```

## Socket.io (server emits; client listens)
- `world:update` {tick, gameDate, prices, onlineCount} — every tick + on major actions
- `news:new` {news item}
- `chat:message` {channel, from, text, at}
- `notify` {text, kind} — personal notifications (offer received, event, treaty accepted…)
- `presence` {online:[usernames]}
- Client emits: `chat:send` {channel, text} (server validates + persists + broadcasts).
- Auth for socket: client sends token in `auth: {token}` on connect; server rejects unauthenticated.

## Anti-cheat / validation (BACKEND, non-negotiable)
- Every action re-validated server-side: ownership (is this my country?), treasury sufficiency,
  stockpile sufficiency, ranges, cooldowns, rate limits (express-rate-limit style middleware,
  hand-rolled if needed — no extra dep: simple in-memory limiter).
- Never trust client-supplied computed values; server computes all outcomes.
- All actions logged to an `audit` table (user, action, payload, tick).

## Frontend requirements (FRONTEND agent)
- `public/index.html` + `css/app.css` + `js/app.js`. Vanilla JS, no build step.
- CDN: Leaflet 1.9.x (map) + Chart.js 4.x (charts). Map GeoJSON:
  fetch `https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json`? NO — TopoJSON needs a
  parser. Instead fetch GeoJSON from `https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json`
  and if that fails, fall back to a country-list grid view (still fully functional).
  Markers: capital lat/lng from countries.json. Click a country → profile panel.
- Screens (all functional against the live API): landing, register/login, country select,
  inauguration, dashboard (charts), map, economy/markets, trade marketplace, population,
  healthcare, disasters, diplomacy (+UN), government/ministers, infrastructure, budget,
  news, chat, rankings, profile, admin panel.
- Theme: dark navy (#0a1628 / #0f2038) + charcoal, gold #d4af37, cyan #22d3ee, blue #3b82f6.
  Responsive (desktop/tablet/mobile). Urdu/English toggle — all UI strings via i18n dict
  (data/i18n.json), including RTL (`dir=rtl`) when Urdu is selected.
- Every price/market figure labelled "Simulated market — not real-world data".
- Never invent other players: online list / rankings come only from the API.

## Data requirements (DATA agent)
- `data/countries.json`: 40 countries. Fields per country: code (ISO2), name, nameUr, capital,
  flag (emoji), region, government (one of presidential/parliamentary/monarchy/federal),
  currency, currencySymbol, population (2026 approx), gdpB (USD billions, 2026 approx),
  treasuryM, debtM, reservesM, taxRate (0.05–0.45), inflation, unemployment, approval,
  literacy, poverty, healthIndex, educationIndex, infraIndex, energyTWh, energyGreenPct,
  defenseBudgetM, personnel, lat, lng, resources {oil,gas,coal,iron,timber,wheat,rice,cotton,gold: 0–100},
  production {commodity: units/day}, consumption {commodity: units/day},
  climate: {quake, flood, drought, storm, wildfire, heatwave: 0–5 risk}, neighbours: [codes].
  Use realistic 2026 approximations; do not claim precision — values are game starting points.
  Include: Pakistan, India, China, USA, UK, France, Germany, Russia, Japan, Brazil, Canada,
  Australia, Saudi Arabia, UAE, Turkey, Iran, Egypt, Nigeria, South Africa, Indonesia,
  Bangladesh, Sri Lanka, Nepal, Afghanistan, Kazakhstan, Ukraine, Poland, Italy, Spain,
  Mexico, Argentina, Kenya, Ethiopia, Vietnam, Thailand, South Korea, Malaysia, Qatar, Iraq, Syria.
  (Count = 40; adjust list to exactly 40.)
- `data/commodities.json`: the 21 commodities from spec §3 with basePrice, unit, category.
- `data/events.json`: disaster/disease/economic event templates {id, type, name, nameUr,
  severityScale, baseDamage, description}.
- `data/i18n.json`: {en:{...}, ur:{...}} with keys for every UI string the frontend needs
  (nav, buttons, dashboard labels, screens, common actions). Keep keys identical in both.

## Run/verify (BACKEND agent + coordinator)
- `cd ~/workspace/world-president/server && npm install && npm start` → server on PORT (default 3000),
  serves `../public` statically, seeds DB on first boot, starts tick loop.
- `npm test` → backend smoke test (register/login/claim/trade/tick/persistence) — write it.
- Dockerfile + railway.json + .env.example + README.md with Railway + Supabase deploy steps.
