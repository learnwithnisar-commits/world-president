'use strict';
/**
 * Server-authoritative simulation tick. One tick = 1 game day.
 * Pure-ish: runTick(store, ctx) mutates country states in the store and
 * returns a summary {tick, gameDate, prices, news[]} for the caller to emit.
 * ctx: {tick, gameDate, commodities, eventTemplates, emitNews(newsItem)}.
 */
const { initialState } = require('./seed');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const GAME_START = new Date('2026-01-01T00:00:00Z');
const gameDateFor = (tick) => {
  const d = new Date(GAME_START.getTime() + tick * 86400000);
  return d.toISOString().slice(0, 10);
};

/** Project catalogue: cost in USD millions, duration in ticks, commodity cost, effect on completion. */
const PROJECTS = {
  roads: { cost: 800, ticks: 5, commodities: { steel: 500, timber: 200, construction_materials: 1000 }, effect: { infraIndex: 2 } },
  railways: { cost: 1500, ticks: 8, commodities: { steel: 1200, construction_materials: 1500 }, effect: { infraIndex: 3 } },
  airports: { cost: 2000, ticks: 10, commodities: { steel: 800, construction_materials: 2000, electronics: 200 }, effect: { infraIndex: 3 } },
  seaports: { cost: 1800, ticks: 9, commodities: { steel: 1000, construction_materials: 1800 }, effect: { infraIndex: 3 } },
  hospitals: { cost: 1200, ticks: 6, commodities: { steel: 400, construction_materials: 1200, pharmaceuticals: 300 }, effect: { healthIndex: 4 } },
  schools: { cost: 600, ticks: 4, commodities: { timber: 300, construction_materials: 800 }, effect: { educationIndex: 3 } },
  universities: { cost: 1500, ticks: 7, commodities: { steel: 500, construction_materials: 1500, electronics: 300 }, effect: { educationIndex: 4 } },
  power: { cost: 2500, ticks: 10, commodities: { steel: 1500, copper: 500, machinery: 300 }, effect: { energy: 40 } },
  renewables: { cost: 1800, ticks: 8, commodities: { steel: 600, copper: 400, electronics: 400 }, effect: { energy: 25, energyGreenPct: 6 } },
  water: { cost: 900, ticks: 5, commodities: { steel: 300, construction_materials: 900 }, effect: { healthIndex: 2, infraIndex: 1 } },
  factories: { cost: 1600, ticks: 7, commodities: { steel: 1000, machinery: 500 }, effect: { gdpBoost: 0.004 } },
  farms: { cost: 700, ticks: 4, commodities: { timber: 200, fertilizers: 500 }, effect: { gdpBoost: 0.002 } },
  research: { cost: 2000, ticks: 8, commodities: { electronics: 500, machinery: 300 }, effect: { educationIndex: 3, gdpBoost: 0.003 } },
  housing: { cost: 1000, ticks: 6, commodities: { steel: 600, timber: 600, construction_materials: 1500 }, effect: { infraIndex: 2, approval: 2 } },
  digital: { cost: 900, ticks: 5, commodities: { electronics: 600, copper: 300 }, effect: { infraIndex: 2, educationIndex: 1 } },
};

const ACHIEVEMENT_DEFS = [
  { code: 'first_claim', name: 'First Mandate', test: (s) => !!s.president },
  { code: 'treasury_10k', name: 'Treasury Builder', test: (s) => s.treasury >= 10000 },
  { code: 'treasury_100k', name: 'National Fortune', test: (s) => s.treasury >= 100000 },
  { code: 'approval_70', name: 'Beloved Leader', test: (s) => s.approval >= 70 },
  { code: 'green_50', name: 'Green Pioneer', test: (s) => s.energyGreenPct >= 50 },
  { code: 'literacy_90', name: 'Educated Nation', test: (s) => s.literacy >= 0.90 },
  { code: 'health_80', name: 'Healthy Nation', test: (s) => s.healthIndex >= 80 },
  { code: 'infra_80', name: 'Modern Infrastructure', test: (s) => s.infraIndex >= 80 },
  { code: 'debt_free', name: 'Debt Free', test: (s) => s.debt <= 0 },
  { code: 'gdp_1t', name: 'Trillion Club', test: (s) => s.gdp >= 1000 },
];

async function checkAchievements(store, state) {
  if (!state.presidentUserId) return [];
  const have = new Set((await store.getAchievements(state.presidentUserId)).map((a) => a.code));
  const unlocked = [];
  for (const def of ACHIEVEMENT_DEFS) {
    if (!have.has(def.code) && def.test(state)) {
      await store.unlockAchievement(state.presidentUserId, def.code, def.name);
      unlocked.push(def);
    }
  }
  return unlocked;
}

function tickCountry(state, ctx) {
  const { tick, prices } = ctx;
  const news = [];
  // --- revenue / expenses (USD millions per game day; GDP in USD billions)
  const gdpM = state.gdp * 1000;
  const revenue = (gdpM * state.taxRate) / 365;
  const healthSpend = (gdpM * (state.healthBudget || 8) / 100) / 365;
  const eduSpend = (gdpM * (state.educationBudget || 8) / 100) / 365;
  const defenseSpend = (state.defenseBudget || 0) / 365;
  const infraMaint = (gdpM * 0.01 * (state.infraIndex / 100)) / 365;
  const debtInterest = (state.debt * 0.05) / 365;
  const expenses = healthSpend + eduSpend + defenseSpend + infraMaint + debtInterest;
  state.treasury += revenue - expenses;
  state.imports = state.imports || 0;
  state.exports = state.exports || 0;

  // --- GDP growth
  const eduBonus = ((state.educationIndex - 50) / 100) * 0.01;
  const infraBonus = ((state.infraIndex - 50) / 100) * 0.01;
  const healthBonus = ((state.healthIndex - 50) / 100) * 0.005;
  const taxDrag = (state.taxRate - 0.20) * 0.02;
  const interestDrag = ((state.interestRate || 0.08) - 0.05) * 0.05;
  let growth = 0.03 + eduBonus + infraBonus + healthBonus - taxDrag - interestDrag + (state.gdpBoost || 0);
  growth = clamp(growth, -0.05, 0.10);
  state.growthRate = growth;
  state.gdp = Math.max(1, state.gdp * (1 + growth / 365));
  state.gdpPerCapita = Math.round((state.gdp * 1e9) / Math.max(1, state.population));
  state.gdpBoost = 0;

  // --- population
  const births = Math.round(state.population * (state.birthRate || 0.018) / 365);
  const deaths = Math.round(state.population * (state.deathRate || 0.007) / 365);
  const migration = Math.round(state.population * 0.0002 * ((state.approval - 50) / 50) / 365);
  state.population = Math.max(1000, state.population + births - deaths + migration);
  state.birthsPerDay = births; state.deathsPerDay = deaths; state.migrationNet = migration;

  // --- unemployment / approval drift toward policy targets
  const unempTarget = clamp(0.04 + (state.taxRate - 0.15) * 0.3 - (state.infraIndex - 50) * 0.0004 - (state.educationIndex - 50) * 0.0003, 0.02, 0.30);
  state.unemployment += (unempTarget - state.unemployment) * 0.01;
  const approvalTarget = clamp(50 + (state.healthIndex - 55) * 0.3 + (state.educationIndex - 55) * 0.25
    + (state.infraIndex - 55) * 0.2 - (state.taxRate - 0.18) * 120 - state.unemployment * 100
    - (state.poverty * 40), 5, 98);
  state.approval += (approvalTarget - state.approval) * 0.01;
  state.approval = clamp(state.approval, 1, 99);

  // --- inflation drift
  state.inflation = clamp(state.inflation + ((state.interestRate || 0.08) - 0.05) * -0.002 + rand(-0.0004, 0.0004), -0.02, 0.30);

  // --- literacy / poverty slow drift
  state.literacy = clamp(state.literacy + ((state.educationIndex - 50) / 100) * 0.00004, 0.05, 0.999);
  state.poverty = clamp(state.poverty - ((state.growthRate) * 0.002) + ((state.unemployment - 0.05) * 0.0005), 0.01, 0.95);

  // --- indices drift slowly toward spending-implied levels
  state.healthIndex = clamp(state.healthIndex + (((state.healthBudget || 8) - 6) * 0.004) + rand(-0.01, 0.01), 5, 100);
  state.educationIndex = clamp(state.educationIndex + (((state.educationBudget || 8) - 6) * 0.004) + rand(-0.01, 0.01), 5, 100);
  state.qualityOfLife = Math.round((state.healthIndex + state.educationIndex + state.infraIndex) / 3);
  state.greenScore = Math.round(state.energyGreenPct * 0.6 + state.infraIndex * 0.4);

  // --- stockpiles: production - consumption per day (units are per-day rates)
  const stockCap = 2000000 + Math.round((state.infraIndex || 50) * 10000);
  for (const [commodity, prod] of Object.entries(state.production || {})) {
    const cons = (state.consumption || {})[commodity] || 0;
    const cur = state.stockpiles[commodity] || 0;
    state.stockpiles[commodity] = Math.max(0, Math.min(stockCap, cur + (prod - cons)));
  }

  // --- diseases progress
  for (const d of state.diseases || []) {
    const recovery = 0.02 + (state.healthIndex / 100) * 0.03;
    d.affected = Math.max(0, Math.round(d.affected * (1 - recovery) + rand(-0.01, 0.02) * d.affected));
    d.trend = d.affected > (d.prevAffected || d.affected) ? 'rising' : 'falling';
    d.prevAffected = d.affected;
  }
  state.diseases = (state.diseases || []).filter((d) => d.affected > 100);

  // --- projects completing this tick
  for (const p of state.projects || []) {
    if (p.status === 'in_progress' && tick >= p.completesTick) {
      p.status = 'completed';
      const def = PROJECTS[p.project];
      if (def) applyProjectEffect(state, def.effect);
      news.push({
        category: 'economy', title: `${state.name} completes ${p.project} project`,
        body: `${state.name} has completed construction of ${p.project}. National indicators improved.`,
      });
    }
  }
  return news;
}

function applyProjectEffect(state, effect) {
  if (effect.infraIndex) state.infraIndex = clamp(state.infraIndex + effect.infraIndex, 5, 100);
  if (effect.healthIndex) state.healthIndex = clamp(state.healthIndex + effect.healthIndex, 5, 100);
  if (effect.educationIndex) state.educationIndex = clamp(state.educationIndex + effect.educationIndex, 5, 100);
  if (effect.energy) state.energy = (state.energy || 0) + effect.energy;
  if (effect.energyGreenPct) state.energyGreenPct = clamp(state.energyGreenPct + effect.energyGreenPct, 0, 100);
  if (effect.approval) state.approval = clamp(state.approval + effect.approval, 1, 99);
  if (effect.gdpBoost) state.gdpBoost = (state.gdpBoost || 0) + effect.gdpBoost;
}

/** Pick a random event for a country, weighted by its climate risk profile. */
function maybeEvent(state, ctx) {
  const climate = state.climate || {};
  const totalRisk = Object.values(climate).reduce((a, b) => a + (b || 0), 0) || 1;
  // Base daily chance ~0.8%, scaled by risk (avg risk 2.5 -> ~1x).
  if (Math.random() > 0.008 * (totalRisk / 15)) return null;
  const templates = ctx.eventTemplates;
  if (!templates.length) return null;
  // Weight templates whose type matches a high-risk climate key.
  const keyMap = { earthquake: 'quake', flood: 'flood', drought: 'drought', storm: 'storm', wildfire: 'wildfire', heatwave: 'heatwave' };
  const weighted = [];
  for (const t of templates) {
    const risk = keyMap[t.id] ? (climate[keyMap[t.id]] || 0) : 2;
    for (let i = 0; i < Math.max(1, risk); i++) weighted.push(t);
  }
  const tpl = weighted[Math.floor(Math.random() * weighted.length)];
  const severity = 1 + Math.floor(Math.random() * (tpl.severityScale || 3));
  return { tpl, severity };
}

/** One tick for the whole world. Returns {tick, gameDate, prices, news}. */
async function runTick(store, ctx) {
  const tick = ctx.tick;
  const gameDate = gameDateFor(tick);
  const states = await store.getAllCountryStates();
  const prices = await store.getPrices();
  const allNews = [];

  // Aggregate supply/demand across ALL countries (claimed or not) for prices.
  const supply = {}; const demand = {};
  for (const s of states) {
    for (const [c, v] of Object.entries(s.production || {})) supply[c] = (supply[c] || 0) + v;
    for (const [c, v] of Object.entries(s.consumption || {})) demand[c] = (demand[c] || 0) + v;
  }

  // Move prices.
  for (const [commodity, p] of Object.entries(prices)) {
    const sup = supply[commodity] || 1000;
    const dem = demand[commodity] || 1000;
    const move = clamp(((dem - sup) / sup) * 0.02 + rand(-0.01, 0.01), -0.05, 0.05);
    const newPrice = Math.max(0.01, p.price * (1 + move));
    await store.setPrice(commodity, newPrice, p.price, sup, dem);
    prices[commodity] = { price: newPrice, prevPrice: p.price, supply: sup, demand: dem };
    if (Math.abs(move) >= 0.045) {
      allNews.push({
        category: 'economy', title: `${commodity.replace(/_/g, ' ')} price ${move > 0 ? 'surges' : 'drops'} ${Math.abs(move * 100).toFixed(1)}%`,
        body: `Global ${commodity.replace(/_/g, ' ')} prices moved sharply on supply and demand shifts. Simulated market — not real-world data.`,
      });
    }
  }

  // Tick each claimed country.
  for (const state of states) {
    if (!state.presidentUserId) continue;
    const news = tickCountry(state, { tick, prices });
    for (const n of news) allNews.push({ ...n, tick, gameDate });
    // Random event?
    const ev = maybeEvent(state, ctx);
    if (ev) {
      const damage = Math.round((ev.tpl.baseDamage || 300) * ev.severity * (1 - state.infraIndex / 250));
      state.treasury -= damage * 0.2;
      state.approval = clamp(state.approval - ev.severity * 1.5, 1, 99);
      const id = await store.addPendingEvent(state.code, ev.tpl, ev.severity, tick,
        { damageM: damage, title: ev.tpl.name });
      state.events = state.events || [];
      state.events.push({ id, templateId: ev.tpl.id, name: ev.tpl.name, severity: ev.severity, status: 'pending', tick });
      if (ev.tpl.type === 'disease') {
        state.diseases.push({ name: ev.tpl.name, affected: Math.round(state.population * 0.002 * ev.severity), severity: ev.severity, trend: 'rising', prevAffected: 0 });
      }
      allNews.push({
        category: 'disaster', title: `${ev.tpl.name} strikes ${state.name}`,
        body: `${ev.tpl.description} Estimated damage: $${damage}M. The president can respond with emergency funds.`,
      });
    }
    // Sync DB project rows with state projects.
    const dbProjects = await store.listProjects(state.code);
    for (const dp of dbProjects) {
      if (dp.status === 'in_progress' && tick >= dp.completes_tick) {
        await store.updateProject(dp.id, 'completed');
      }
    }
    const sp = state.projects || [];
    for (const p of sp) {
      const match = dbProjects.find((d) => d.project === p.project && d.started_tick === p.startedTick);
      if (match && match.status === 'completed') p.status = 'completed';
    }
    await store.saveCountryState(state);
    const unlocked = await checkAchievements(store, state);
    for (const a of unlocked) {
      await store.addNotification(state.presidentUserId, `Achievement unlocked: ${a.name}`, 'achievement');
      allNews.push({ category: 'politics', title: `${state.name} earns achievement: ${a.name}`, body: `President of ${state.name} unlocked the "${a.name}" achievement.` });
    }
  }

  // Persist news items.
  const savedNews = [];
  for (const n of allNews) {
    const id = await store.addNews({ tick, gameDate, ...n });
    savedNews.push({ id, tick, gameDate, ...n });
  }
  return { tick, gameDate, prices, news: savedNews };
}

module.exports = { runTick, gameDateFor, PROJECTS, ACHIEVEMENT_DEFS, checkAchievements, clamp };
