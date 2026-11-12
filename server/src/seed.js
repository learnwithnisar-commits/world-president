'use strict';
/**
 * Seed data for WORLD PRESIDENT.
 * Primary source: data/countries.json, data/commodities.json, data/events.json
 * (owned by the DATA agent). If those files are not present yet, a built-in
 * fallback seed of 5 countries + all 21 commodities + event templates is used
 * so the server still boots and is testable. The loader is idempotent: it
 * skips seeding when countries already exist in the store.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

function readJsonIfExists(file) {
  try {
    const p = path.join(DATA_DIR, file);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) { console.error(`[seed] failed to read ${file}:`, e.message); }
  return null;
}

// ---------------------------------------------------------------- fallback
const FALLBACK_COUNTRIES = [
  {
    code: 'PK', name: 'Pakistan', nameUr: 'پاکستان', capital: 'Islamabad', flag: '🇵🇰',
    region: 'Asia', government: 'federal', currency: 'Pakistani Rupee', currencySymbol: 'Rs',
    population: 255000000, gdpB: 338, treasuryM: 5200, debtM: 268000, reservesM: 14500,
    taxRate: 0.15, inflation: 0.09, unemployment: 0.08, approval: 52, literacy: 0.60,
    poverty: 0.36, healthIndex: 48, educationIndex: 46, infraIndex: 44,
    energyTWh: 130, energyGreenPct: 35, defenseBudgetM: 6300, personnel: 654000,
    lat: 33.68, lng: 73.05,
    resources: { oil: 15, gas: 45, coal: 60, iron: 40, timber: 25, wheat: 85, rice: 80, cotton: 90, gold: 20 },
    production: { oil: 120, natural_gas: 900, wheat: 70000, rice: 22000, cotton: 5500, steel: 12000, coal: 15000, timber: 3000, fertilizers: 8000 },
    consumption: { oil: 450, natural_gas: 1100, wheat: 75000, rice: 12000, cotton: 4000, steel: 14000, coal: 18000, timber: 4500, fertilizers: 9000 },
    climate: { quake: 4, flood: 5, drought: 3, storm: 2, wildfire: 1, heatwave: 4 },
    neighbours: ['IN', 'CN', 'AF', 'IR'],
  },
  {
    code: 'IN', name: 'India', nameUr: 'بھارت', capital: 'New Delhi', flag: '🇮🇳',
    region: 'Asia', government: 'federal', currency: 'Indian Rupee', currencySymbol: '₹',
    population: 1450000000, gdpB: 3900, treasuryM: 42000, debtM: 2600000, reservesM: 640000,
    taxRate: 0.18, inflation: 0.055, unemployment: 0.075, approval: 58, literacy: 0.77,
    poverty: 0.22, healthIndex: 58, educationIndex: 62, infraIndex: 60,
    energyTWh: 1750, energyGreenPct: 42, defenseBudgetM: 74000, personnel: 1455000,
    lat: 28.61, lng: 77.21,
    resources: { oil: 25, gas: 35, coal: 90, iron: 85, timber: 55, wheat: 95, rice: 95, cotton: 90, gold: 30 },
    production: { oil: 800, natural_gas: 900, wheat: 290000, rice: 360000, cotton: 16000, steel: 340000, coal: 900000, timber: 20000, fertilizers: 45000 },
    consumption: { oil: 5200, natural_gas: 1700, wheat: 280000, rice: 300000, cotton: 14000, steel: 300000, coal: 950000, timber: 22000, fertilizers: 48000 },
    climate: { quake: 3, flood: 4, drought: 3, storm: 3, wildfire: 1, heatwave: 4 },
    neighbours: ['PK', 'CN', 'BD', 'NP'],
  },
  {
    code: 'CN', name: 'China', nameUr: 'چین', capital: 'Beijing', flag: '🇨🇳',
    region: 'Asia', government: 'presidential', currency: 'Yuan', currencySymbol: '¥',
    population: 1410000000, gdpB: 18700, treasuryM: 180000, debtM: 12000000, reservesM: 3200000,
    taxRate: 0.20, inflation: 0.02, unemployment: 0.05, approval: 65, literacy: 0.97,
    poverty: 0.05, healthIndex: 76, educationIndex: 78, infraIndex: 88,
    energyTWh: 8500, energyGreenPct: 32, defenseBudgetM: 230000, personnel: 2035000,
    lat: 39.9, lng: 116.4,
    resources: { oil: 40, gas: 50, coal: 95, iron: 80, timber: 60, wheat: 90, rice: 95, cotton: 75, gold: 60 },
    production: { oil: 4200, natural_gas: 2200, wheat: 360000, rice: 380000, cotton: 15000, steel: 2700000, coal: 4200000, timber: 60000, fertilizers: 120000 },
    consumption: { oil: 15000, natural_gas: 3800, wheat: 350000, rice: 360000, cotton: 17000, steel: 2500000, coal: 4300000, timber: 65000, fertilizers: 115000 },
    climate: { quake: 4, flood: 4, drought: 2, storm: 3, wildfire: 1, heatwave: 3 },
    neighbours: ['IN', 'PK', 'RU', 'KZ'],
  },
  {
    code: 'US', name: 'United States', nameUr: 'امریکہ', capital: 'Washington, D.C.', flag: '🇺🇸',
    region: 'North America', government: 'federal', currency: 'US Dollar', currencySymbol: '$',
    population: 340000000, gdpB: 29000, treasuryM: 220000, debtM: 36000000, reservesM: 240000,
    taxRate: 0.22, inflation: 0.03, unemployment: 0.04, approval: 55, literacy: 0.99,
    poverty: 0.11, healthIndex: 84, educationIndex: 86, infraIndex: 85,
    energyTWh: 4200, energyGreenPct: 40, defenseBudgetM: 820000, personnel: 1328000,
    lat: 38.9, lng: -77.04,
    resources: { oil: 95, gas: 95, coal: 80, iron: 60, timber: 85, wheat: 85, rice: 30, cotton: 70, gold: 55 },
    production: { oil: 19500, natural_gas: 26000, wheat: 130000, rice: 18000, cotton: 9000, steel: 220000, coal: 1100000, timber: 90000, fertilizers: 40000 },
    consumption: { oil: 19000, natural_gas: 24000, wheat: 90000, rice: 16000, cotton: 8000, steel: 260000, coal: 1000000, timber: 95000, fertilizers: 42000 },
    climate: { quake: 3, flood: 3, drought: 2, storm: 4, wildfire: 4, heatwave: 3 },
    neighbours: ['CA', 'MX'],
  },
  {
    code: 'BR', name: 'Brazil', nameUr: 'برازیل', capital: 'Brasília', flag: '🇧🇷',
    region: 'South America', government: 'presidential', currency: 'Brazilian Real', currencySymbol: 'R$',
    population: 216000000, gdpB: 2100, treasuryM: 28000, debtM: 1500000, reservesM: 350000,
    taxRate: 0.24, inflation: 0.045, unemployment: 0.08, approval: 54, literacy: 0.94,
    poverty: 0.27, healthIndex: 66, educationIndex: 64, infraIndex: 58,
    energyTWh: 680, energyGreenPct: 88, defenseBudgetM: 22000, personnel: 360000,
    lat: -15.79, lng: -47.88,
    resources: { oil: 70, gas: 40, coal: 15, iron: 95, timber: 90, wheat: 30, rice: 30, cotton: 65, gold: 55 },
    production: { oil: 3400, natural_gas: 700, wheat: 18000, rice: 28000, cotton: 8000, steel: 90000, coal: 18000, timber: 70000, fertilizers: 12000 },
    consumption: { oil: 3000, natural_gas: 900, wheat: 30000, rice: 30000, cotton: 5000, steel: 70000, coal: 25000, timber: 55000, fertilizers: 25000 },
    climate: { quake: 0, flood: 3, drought: 3, storm: 1, wildfire: 3, heatwave: 3 },
    neighbours: ['AR'],
  },
];

// 21 commodities from spec §3. Prices are SIMULATED game starting points (USD per unit).
const FALLBACK_COMMODITIES = [
  { id: 'oil', name: 'Oil', unit: 'barrel', category: 'energy', basePrice: 78 },
  { id: 'natural_gas', name: 'Natural Gas', unit: 'MMBtu', category: 'energy', basePrice: 3.2 },
  { id: 'electricity', name: 'Electricity', unit: 'MWh', category: 'energy', basePrice: 65 },
  { id: 'wheat', name: 'Wheat', unit: 'tonne', category: 'agriculture', basePrice: 240 },
  { id: 'rice', name: 'Rice', unit: 'tonne', category: 'agriculture', basePrice: 480 },
  { id: 'corn', name: 'Corn', unit: 'tonne', category: 'agriculture', basePrice: 190 },
  { id: 'sugar', name: 'Sugar', unit: 'tonne', category: 'agriculture', basePrice: 520 },
  { id: 'cotton', name: 'Cotton', unit: 'tonne', category: 'agriculture', basePrice: 1650 },
  { id: 'gold', name: 'Gold', unit: 'oz', category: 'metals', basePrice: 2650 },
  { id: 'silver', name: 'Silver', unit: 'oz', category: 'metals', basePrice: 31 },
  { id: 'copper', name: 'Copper', unit: 'tonne', category: 'metals', basePrice: 9200 },
  { id: 'iron', name: 'Iron Ore', unit: 'tonne', category: 'metals', basePrice: 105 },
  { id: 'steel', name: 'Steel', unit: 'tonne', category: 'metals', basePrice: 720 },
  { id: 'coal', name: 'Coal', unit: 'tonne', category: 'energy', basePrice: 130 },
  { id: 'timber', name: 'Timber', unit: 'm³', category: 'materials', basePrice: 310 },
  { id: 'pharmaceuticals', name: 'Pharmaceuticals', unit: 'unit', category: 'manufactured', basePrice: 45 },
  { id: 'electronics', name: 'Electronics', unit: 'unit', category: 'manufactured', basePrice: 220 },
  { id: 'vehicles', name: 'Vehicles', unit: 'unit', category: 'manufactured', basePrice: 24000 },
  { id: 'machinery', name: 'Machinery', unit: 'unit', category: 'manufactured', basePrice: 8500 },
  { id: 'fertilizers', name: 'Fertilizers', unit: 'tonne', category: 'agriculture', basePrice: 410 },
  { id: 'construction_materials', name: 'Construction Materials', unit: 'tonne', category: 'materials', basePrice: 160 },
];

const FALLBACK_EVENTS = [
  { id: 'earthquake', type: 'disaster', name: 'Earthquake', nameUr: 'زلزلہ', severityScale: 3, baseDamage: 800, description: 'A powerful earthquake strikes a populated region.' },
  { id: 'flood', type: 'disaster', name: 'Flood', nameUr: 'سیلاب', severityScale: 3, baseDamage: 600, description: 'Heavy rains cause severe flooding across river plains.' },
  { id: 'drought', type: 'disaster', name: 'Drought', nameUr: 'خشک سالی', severityScale: 3, baseDamage: 400, description: 'A prolonged drought damages crops and water supplies.' },
  { id: 'storm', type: 'disaster', name: 'Storm', nameUr: 'طوفان', severityScale: 3, baseDamage: 500, description: 'A violent storm damages infrastructure and homes.' },
  { id: 'wildfire', type: 'disaster', name: 'Wildfire', nameUr: 'جنگل کی آگ', severityScale: 3, baseDamage: 350, description: 'Wildfires spread through forests and rural areas.' },
  { id: 'heatwave', type: 'disaster', name: 'Heatwave', nameUr: 'گرمی کی لہر', severityScale: 3, baseDamage: 250, description: 'An extreme heatwave strains energy and health systems.' },
  { id: 'pandemic', type: 'disease', name: 'Pandemic Outbreak', nameUr: 'وبا', severityScale: 3, baseDamage: 500, description: 'A contagious disease spreads rapidly through the population.' },
  { id: 'recession', type: 'economic', name: 'Economic Recession', nameUr: 'معاشی کساد بازاری', severityScale: 3, baseDamage: 300, description: 'A sharp downturn hits trade and domestic demand.' },
  { id: 'energy_shortage', type: 'economic', name: 'Energy Shortage', nameUr: 'توانائی کی قلت', severityScale: 3, baseDamage: 300, description: 'Energy supply falls short of demand, factories slow down.' },
  { id: 'crop_failure', type: 'disaster', name: 'Crop Failure', nameUr: 'فصل کی ناکامی', severityScale: 3, baseDamage: 350, description: 'Pests and poor weather destroy a large share of the harvest.' },
  { id: 'refugee_influx', type: 'social', name: 'Refugee Influx', nameUr: 'مہاجرین کی آمد', severityScale: 3, baseDamage: 200, description: 'A sudden influx of refugees needs shelter and services.' },
  { id: 'financial_crisis', type: 'economic', name: 'Financial Crisis', nameUr: 'مالی بحران', severityScale: 3, baseDamage: 600, description: 'Markets crash and credit dries up across the economy.' },
];

/** Build a fresh playable country state from a base country record. */
function initialState(base) {
  const stockpiles = {};
  for (const c of FALLBACK_COMMODITIES) stockpiles[c.id] = 0;
  const prod = base.production || {};
  // Cap initial stockpiles at the same cap the market/trade code enforces,
  // otherwise big producers could never buy anything.
  const cap = 2000000 + Math.round((base.infraIndex || 50) * 10000);
  // Seed at most half the cap so the country can still buy/trade on day one.
  for (const [k, v] of Object.entries(prod)) stockpiles[k] = Math.min(Math.round((v || 0) * 10), Math.round(cap * 0.5));
  const births = Math.round(base.population * 0.018 / 365);
  const deaths = Math.round(base.population * 0.007 / 365);
  return {
    code: base.code, name: base.name, nameUr: base.nameUr || null, capital: base.capital,
    flag: base.flag, region: base.region, government: base.government,
    currency: base.currency, currencySymbol: base.currencySymbol,
    president: null, presidentUserId: null,
    population: base.population, gdp: base.gdpB, // GDP in USD billions
    gdpPerCapita: Math.round((base.gdpB * 1e9) / base.population),
    treasury: base.treasuryM, debt: base.debtM, reserves: base.reservesM,
    taxRate: base.taxRate, inflation: base.inflation, unemployment: base.unemployment,
    approval: base.approval, literacy: base.literacy, poverty: base.poverty,
    healthIndex: base.healthIndex, educationIndex: base.educationIndex,
    infraIndex: base.infraIndex, energy: base.energyTWh, energyGreenPct: base.energyGreenPct,
    defenseBudget: base.defenseBudgetM, personnel: base.personnel,
    readiness: 60, interestRate: 0.08,
    healthBudget: 8, educationBudget: 8, // % of GDP-equivalent budget shares
    imports: 0, exports: 0, tradeBalance: 0,
    stockpiles,
    ministers: {},
    projects: [],
    events: [],
    diseases: [],
    relationsSummary: {},
    achievements: [],
    lat: base.lat, lng: base.lng,
    resources: base.resources || {},
    production: prod, consumption: base.consumption || {},
    climate: base.climate || {}, neighbours: base.neighbours || [],
    birthRate: 0.018, deathRate: 0.007, birthsPerDay: births, deathsPerDay: deaths,
    urbanPct: 0.55, migrationNet: 0,
    hospitals: Math.max(1, Math.round(base.population / 250000)),
    doctors: Math.round(base.population / 1200),
    beds: Math.round(base.population / 400),
    vaccination: 0.75,
    equipment: { tanks: Math.round(base.personnel / 120), jets: Math.round(base.personnel / 9000), ships: Math.round(base.personnel / 30000) },
    growthRate: 0.03,
    qualityOfLife: Math.round((base.healthIndex + base.educationIndex + base.infraIndex) / 3),
    influence: 50, greenScore: Math.round(base.energyGreenPct * 0.6 + base.infraIndex * 0.4),
  };
}

function loadDataFiles() {
  const countries = readJsonIfExists('countries.json');
  const commodities = readJsonIfExists('commodities.json');
  const events = readJsonIfExists('events.json');
  return {
    countries: Array.isArray(countries) ? countries : (countries && countries.countries) || FALLBACK_COUNTRIES,
    commodities: Array.isArray(commodities) ? commodities : (commodities && commodities.commodities) || FALLBACK_COMMODITIES,
    events: Array.isArray(events) ? events : (events && events.events) || FALLBACK_EVENTS,
    fromFiles: !!(countries || commodities || events),
  };
}

/** Idempotent seed. Returns {seeded, countries, commodities, events}. */
async function seedIfEmpty(store) {
  const existing = await store.countCountries();
  const data = loadDataFiles();
  if (existing > 0) {
    // Repair: a world seeded from the built-in fallback (e.g. a bad deploy
    // layout hid data/*.json) must be rebuilt from the real files — but
    // ONLY while nobody has registered yet, so no player progress is lost.
    // Worlds seeded correctly record seed_source='files' and never repair.
    const users = await store.countUsers();
    const source = await store.getMeta('seed_source');
    if (users === 0 && data.fromFiles && source !== 'files') {
      console.log('[seed] repairing fallback-seeded world from data/*.json (0 users, nothing to lose)');
      await store.resetWorld();
    } else {
      return { seeded: false, ...data };
    }
  }
  for (const c of data.countries) {
    await store.seedCountry(c, initialState(c));
  }
  for (const c of data.commodities) {
    await store.seedPrice(c.id || c.commodity, c.basePrice ?? c.price ?? 100);
  }
  await store.setMeta('event_templates', JSON.stringify(data.events));
  await store.setMeta('commodities', JSON.stringify(data.commodities));
  await store.setMeta('seeded_at', new Date().toISOString());
  await store.setMeta('seed_source', data.fromFiles ? 'files' : 'fallback');
  console.log(`[seed] seeded ${data.countries.length} countries, ${data.commodities.length} commodities from ${data.fromFiles ? 'data/*.json' : 'built-in fallback'}`);
  return { seeded: true, ...data };
}

module.exports = { FALLBACK_COUNTRIES, FALLBACK_COMMODITIES, FALLBACK_EVENTS, initialState, loadDataFiles, seedIfEmpty };
