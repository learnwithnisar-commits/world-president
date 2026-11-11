'use strict';
/**
 * WORLD PRESIDENT — backend server (Express + Socket.io).
 * All game logic is server-authoritative; every action is re-validated here.
 * See ARCHITECTURE.md for the API contract.
 */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Server } = require('socket.io');
const { createStore } = require('./store');
const { seedIfEmpty, loadDataFiles, initialState } = require('./seed');
const { runTick, gameDateFor, PROJECTS, ACHIEVEMENT_DEFS, checkAchievements } = require('./sim');
const { advisors } = require('./advisors');

const PORT = Number(process.env.PORT || 3000);
const SESSION_DAYS = 30;
const STOCKPILE_CAP_BASE = 2000000;
const CHAT_MAX = 500;

const store = createStore();
let TICK_SECONDS = Number(process.env.TICK_SECONDS || 60);
let tick = 0;
let gameDate = gameDateFor(0);
let lastTickAt = Date.now();
let tickTimer = null;
let io = null;
const onlineUsers = new Map(); // userId -> {username, socketIds:Set}

// ---------------------------------------------------------------- helpers
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const bad = (res, status, msg) => res.status(status).json({ error: msg });
const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email, is_admin: u.is_admin });

function newToken() { return crypto.randomBytes(32).toString('hex'); }

async function audit(req, action, payload) {
  try { await store.logAudit(req.user ? req.user.id : null, action, payload || {}, tick); } catch (e) { /* audit must never break the action */ }
}

// ---- in-memory rate limiting (hand-rolled, no extra dep)
const rateBuckets = new Map(); // key -> [timestamps]
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return true;
  arr.push(now);
  rateBuckets.set(key, arr);
  return false;
}
const cooldowns = new Map(); // userId:key -> timestamp
function onCooldown(userId, key, ms) {
  const k = `${userId}:${key}`;
  const last = cooldowns.get(k) || 0;
  if (Date.now() - last < ms) return true;
  cooldowns.set(k, Date.now());
  return false;
}

// ---- auth
async function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return bad(res, 401, 'Missing Authorization Bearer token');
  const session = await store.findSession(token);
  if (!session) return bad(res, 401, 'Invalid session token');
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await store.deleteSession(token);
    return bad(res, 401, 'Session expired');
  }
  const user = await store.findUserById(session.user_id);
  if (!user) return bad(res, 401, 'User not found');
  if (user.banned) return bad(res, 403, 'Account banned');
  req.user = user;
  req.token = token;
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user.is_admin) return bad(res, 403, 'Admin only');
  next();
}

/** Load my country state or 400. */
async function myCountry(req, res) {
  const code = await store.countryOfUser(req.user.id);
  if (!code) { bad(res, 400, 'You have not claimed a country yet'); return null; }
  const state = await store.getCountryState(code);
  if (!state) { bad(res, 404, 'Country state not found'); return null; }
  return state;
}

/** Enrich a state with live DB rows (projects, ministers, pending events). */
async function enrichState(state) {
  const [projects, ministers, pending] = await Promise.all([
    store.listProjects(state.code),
    store.getMinisters(state.code),
    store.listPendingEvents(state.code),
  ]);
  const out = { ...state };
  out.projects = projects.map((p) => ({ id: p.id, project: p.project, status: p.status, startedTick: p.started_tick, completesTick: p.completes_tick }));
  out.ministers = { ...state.ministers, ...ministers };
  out.events = pending.map((e) => ({ id: e.id, templateId: e.template_id, name: e.name, severity: e.severity, status: e.status, tick: e.tick, data: safeJson(e.data_json) }));
  return out;
}
function safeJson(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }

function stockpileCap(state) {
  return STOCKPILE_CAP_BASE + Math.round((state.infraIndex || 50) * 10000);
}

async function notifyUser(userId, text, kind) {
  await store.addNotification(userId, text, kind || 'info');
  for (const [, u] of onlineUsers) {
    if (u.userId === userId) {
      for (const sid of u.socketIds) io.to(sid).emit('notify', { text, kind: kind || 'info' });
    }
  }
}

async function postNews(item) {
  const id = await store.addNews({ tick, gameDate, ...item });
  const full = { id, tick, gameDate, ...item };
  if (io) io.emit('news:new', full);
  return full;
}

async function broadcastWorld() {
  if (!io) return;
  const prices = await store.getPrices();
  io.emit('world:update', { tick, gameDate, prices, onlineCount: onlineUsers.size });
  io.emit('presence', { online: [...onlineUsers.values()].map((u) => u.username) });
}

// ---------------------------------------------------------------- app
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  // Global per-IP rate limit: 600 requests / minute.
  if (rateLimited(`ip:${req.ip}`, 600, 60000)) return bad(res, 429, 'Too many requests');
  next();
});

// Static frontend (owned by FRONTEND agent; may not exist yet).
const publicDir = path.join(__dirname, '..', '..', 'public');
if (fs.existsSync(publicDir)) app.use(express.static(publicDir));

// Static game data (countries/commodities/i18n) so the frontend can fetch
// data/i18n.json and data/countries.json directly. Read-only JSON.
const dataDir = path.join(__dirname, '..', '..', 'data');
if (fs.existsSync(dataDir)) app.use('/data', express.static(dataDir));

app.get('/api/health', (req, res) => res.json({ status: 'ok', tick, gameDate, backend: store.backend }));

// ---------------------------------------------------------------- auth
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!username || !/^[A-Za-z0-9_]{3,20}$/.test(username)) return bad(res, 400, 'Username must be 3-20 letters, numbers or underscore');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 400, 'Valid email required');
    if (!password || password.length < 6) return bad(res, 400, 'Password must be at least 6 characters');
    if (await store.findUserByUsername(username)) return bad(res, 400, 'Username already taken');
    if (await store.findUserByLogin(email)) return bad(res, 400, 'Email already registered');
    const isAdmin = (await store.countUsers()) === 0; // first user = admin
    const hash = await bcrypt.hash(password, 10);
    const id = await store.createUser(username, email, hash, isAdmin);
    const token = newToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    await store.createSession(token, id, expires);
    await audit({ user: { id } }, 'register', { username });
    res.status(201).json({ token, user: { id, username, email, is_admin: isAdmin } });
  } catch (e) { console.error(e); bad(res, 500, 'Registration failed'); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    const login = username || email;
    if (!login || !password) return bad(res, 400, 'Username/email and password required');
    const user = await store.findUserByLogin(login);
    if (!user) return bad(res, 401, 'Invalid credentials');
    if (user.banned) return bad(res, 403, 'Account banned');
    if (!(await bcrypt.compare(password, user.password_hash))) return bad(res, 401, 'Invalid credentials');
    const token = newToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    await store.createSession(token, user.id, expires);
    res.json({ token, user: publicUser(user) });
  } catch (e) { console.error(e); bad(res, 500, 'Login failed'); }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const countryCode = await store.countryOfUser(req.user.id);
  res.json({ user: publicUser(req.user), countryCode });
});

// ---------------------------------------------------------------- world
app.get('/api/countries', async (req, res) => {
  const bases = await store.listCountryBase();
  const claimed = await store.listClaimedCountries();
  const presByCode = {};
  for (const c of claimed) {
    const u = await store.findUserById(c.president_user_id);
    presByCode[c.code] = u ? u.username : null;
  }
  res.json(bases.map((b) => ({
    code: b.code, name: b.name, capital: b.capital, flag: b.flag, region: b.region,
    government: b.government, population: b.population, gdp: b.gdpB,
    president: presByCode[b.code] || null, claimed: !!presByCode[b.code],
  })));
});

app.post('/api/countries/claim', authMiddleware, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code || typeof code !== 'string') return bad(res, 400, 'Country code required');
    const upper = code.toUpperCase();
    const base = await store.getCountryBase(upper);
    if (!base) return bad(res, 404, 'Unknown country code');
    if (await store.countryOfUser(req.user.id)) return bad(res, 400, 'You already rule a country (one country per president)');
    const state = await store.claimCountry(upper, req.user.id, req.user.username);
    if (!state) return bad(res, 409, 'Country already claimed by another president');
    await checkAchievements(store, state);
    await audit(req, 'claim_country', { code: upper });
    await postNews({ category: 'politics', title: `${req.user.username} becomes President of ${base.name}`, body: `${req.user.username} has been inaugurated as President of ${base.name}.` });
    res.json({ country: await enrichState(state) });
  } catch (e) { console.error(e); bad(res, 500, 'Claim failed'); }
});

app.get('/api/world', async (req, res) => {
  const prices = await store.getPrices();
  const topNews = (await store.listNews(5)).map((n) => ({ id: n.id, tick: n.tick, gameDate: n.game_date, category: n.category, title: n.title, body: n.body }));
  res.json({ tick, gameDate, speed: TICK_SECONDS, onlineCount: onlineUsers.size, prices, topNews });
});

app.get('/api/me/country', authMiddleware, async (req, res) => {
  const state = await myCountry(req, res);
  if (!state) return;
  res.json(await enrichState(state));
});

app.get('/api/countries/:code', async (req, res) => {
  const state = await store.getCountryState(req.params.code);
  if (!state) return bad(res, 404, 'Unknown country code');
  const relations = await store.listRelations(state.code);
  const out = await enrichState(state);
  out.relationsSummary = {
    allies: relations.filter((r) => r.alliance === 'allied').length,
    embassies: relations.filter((r) => r.embassy).length,
    embargoes: relations.filter((r) => r.embargo).length,
    avgScore: relations.length ? Math.round(relations.reduce((a, r) => a + r.score, 0) / relations.length) : 0,
  };
  res.json(out);
});

// ---------------------------------------------------------------- market
function marketShape(prices) {
  return Object.entries(prices).map(([commodity, p]) => ({
    commodity, price: +p.price.toFixed(4), prevPrice: +p.prevPrice.toFixed(4),
    changePct: p.prevPrice ? +(((p.price - p.prevPrice) / p.prevPrice) * 100).toFixed(2) : 0,
    supply: Math.round(p.supply || 0), demand: Math.round(p.demand || 0),
  }));
}
app.get('/api/market', async (req, res) => {
  res.json({ label: 'Simulated market — not real-world data', items: marketShape(await store.getPrices()) });
});

async function marketTrade(req, res, dir) {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    if (onCooldown(req.user.id, `market:${dir}`, 2000)) return bad(res, 429, 'Market actions are limited to one every 2 seconds');
    const { commodity, qty } = req.body || {};
    const prices = await store.getPrices();
    if (!commodity || !prices[commodity]) return bad(res, 400, 'Unknown commodity');
    if (!isNum(qty) || qty <= 0 || qty > 1000000) return bad(res, 400, 'Quantity must be between 1 and 1,000,000');
    const price = prices[commodity].price;
    const totalM = (price * qty) / 1e6; // USD millions
    if (dir === 'buy') {
      if (state.treasury < totalM) return bad(res, 400, `Insufficient treasury: need $${totalM.toFixed(2)}M`);
      const cap = stockpileCap(state);
      if ((state.stockpiles[commodity] || 0) + qty > cap) return bad(res, 400, `Stockpile capacity exceeded (cap ${cap.toLocaleString()} units)`);
      state.treasury -= totalM;
      state.stockpiles[commodity] = (state.stockpiles[commodity] || 0) + qty;
      state.imports += totalM; state.tradeBalance -= totalM;
    } else {
      if ((state.stockpiles[commodity] || 0) < qty) return bad(res, 400, `Insufficient stockpile of ${commodity}`);
      state.treasury += totalM;
      state.stockpiles[commodity] -= qty;
      state.exports += totalM; state.tradeBalance += totalM;
    }
    await store.saveCountryState(state);
    await store.addTrade({ tick, sellerCode: dir === 'buy' ? 'MARKET' : state.code, buyerCode: dir === 'buy' ? state.code : 'MARKET', commodity, qty, pricePerUnit: price, total: totalM, kind: `market_${dir}` });
    await audit(req, `market_${dir}`, { commodity, qty, price, totalM });
    if (totalM > 500) {
      await postNews({ category: 'economy', title: `${state.name} ${dir === 'buy' ? 'buys' : 'sells'} ${qty.toLocaleString()} ${commodity.replace(/_/g, ' ')} for $${totalM.toFixed(0)}M`, body: `A large ${dir} order moved the simulated ${commodity.replace(/_/g, ' ')} market.` });
    }
    res.json({ state: await enrichState(state), price, totalM });
  } catch (e) { console.error(e); bad(res, 500, 'Market trade failed'); }
}
app.post('/api/market/buy', authMiddleware, (req, res) => marketTrade(req, res, 'buy'));
app.post('/api/market/sell', authMiddleware, (req, res) => marketTrade(req, res, 'sell'));

// ---------------------------------------------------------------- trade offers
app.get('/api/trade/offers', authMiddleware, async (req, res) => {
  const state = await myCountry(req, res);
  if (!state) return;
  res.json(await store.listOffersForCountry(state.code));
});

app.post('/api/trade/offer', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    const { toCode, commodity, qty, pricePerUnit } = req.body || {};
    if (!toCode || typeof toCode !== 'string') return bad(res, 400, 'toCode required');
    const to = toCode.toUpperCase();
    if (to === state.code) return bad(res, 400, 'Cannot trade with yourself');
    const target = await store.getCountryState(to);
    if (!target || !target.presidentUserId) return bad(res, 400, 'Target country has no president yet');
    const prices = await store.getPrices();
    if (!commodity || !prices[commodity]) return bad(res, 400, 'Unknown commodity');
    if (!isNum(qty) || qty <= 0 || qty > 1000000) return bad(res, 400, 'Quantity must be between 1 and 1,000,000');
    if (!isNum(pricePerUnit) || pricePerUnit <= 0) return bad(res, 400, 'pricePerUnit must be positive');
    if ((state.stockpiles[commodity] || 0) < qty) return bad(res, 400, `Insufficient stockpile of ${commodity} to offer`);
    const rel = await store.getRelation(state.code, to);
    if (rel && rel.embargo) return bad(res, 400, 'An embargo blocks trade with this country');
    const id = await store.createOffer({ fromCode: state.code, toCode: to, commodity, qty, pricePerUnit });
    await audit(req, 'trade_offer', { id, toCode: to, commodity, qty, pricePerUnit });
    await notifyUser(target.presidentUserId, `${state.name} offers ${qty.toLocaleString()} ${commodity.replace(/_/g, ' ')} at $${pricePerUnit}/unit`, 'trade');
    res.status(201).json({ id, fromCode: state.code, toCode: to, commodity, qty, pricePerUnit, status: 'pending' });
  } catch (e) { console.error(e); bad(res, 500, 'Offer failed'); }
});

app.post('/api/trade/respond', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    const { offerId, accept } = req.body || {};
    const offer = await store.getOffer(Number(offerId));
    if (!offer) return bad(res, 404, 'Offer not found');
    if (offer.status !== 'pending') return bad(res, 400, `Offer already ${offer.status}`);
    if (offer.to_code !== state.code) return bad(res, 403, 'Only the receiving president can respond to this offer');
    if (accept !== true) {
      await store.updateOffer(offer.id, 'rejected');
      await audit(req, 'trade_reject', { offerId: offer.id });
      return res.json({ status: 'rejected' });
    }
    const seller = await store.getCountryState(offer.from_code);
    const totalM = (offer.price_per_unit * offer.qty) / 1e6;
    if (!seller || (seller.stockpiles[offer.commodity] || 0) < offer.qty) {
      await store.updateOffer(offer.id, 'rejected');
      return bad(res, 400, 'Seller no longer holds enough stockpile — offer voided');
    }
    if (state.treasury < totalM) return bad(res, 400, `Insufficient treasury: need $${totalM.toFixed(2)}M`);
    if ((state.stockpiles[offer.commodity] || 0) + offer.qty > stockpileCap(state)) return bad(res, 400, 'Stockpile capacity exceeded');
    seller.stockpiles[offer.commodity] -= offer.qty;
    seller.treasury += totalM; seller.exports += totalM; seller.tradeBalance += totalM;
    state.stockpiles[offer.commodity] = (state.stockpiles[offer.commodity] || 0) + offer.qty;
    state.treasury -= totalM; state.imports += totalM; state.tradeBalance -= totalM;
    await store.saveCountryState(seller);
    await store.saveCountryState(state);
    await store.updateOffer(offer.id, 'accepted');
    await store.addTrade({ tick, sellerCode: seller.code, buyerCode: state.code, commodity: offer.commodity, qty: offer.qty, pricePerUnit: offer.price_per_unit, total: totalM, kind: 'bilateral' });
    await audit(req, 'trade_accept', { offerId: offer.id, totalM });
    await notifyUser(seller.presidentUserId, `${state.name} accepted your offer: ${offer.qty.toLocaleString()} ${offer.commodity.replace(/_/g, ' ')} for $${totalM.toFixed(2)}M`, 'trade');
    if (totalM > 500) {
      await postNews({ category: 'economy', title: `${seller.name} sells ${offer.qty.toLocaleString()} ${offer.commodity.replace(/_/g, ' ')} to ${state.name}`, body: `${seller.name} and ${state.name} completed a $${totalM.toFixed(0)}M bilateral trade deal.` });
    }
    res.json({ status: 'accepted', totalM, state: await enrichState(state) });
  } catch (e) { console.error(e); bad(res, 500, 'Trade response failed'); }
});

// ---------------------------------------------------------------- actions
app.post('/api/actions/policy', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    if (onCooldown(req.user.id, 'policy', 10000)) return bad(res, 429, 'Policy changes are limited to one every 10 seconds');
    const b = req.body || {};
    const check = (v, lo, hi, name) => {
      if (v === undefined) return;
      if (!isNum(v) || v < lo || v > hi) throw new Error(`${name} must be between ${lo} and ${hi}`);
    };
    try {
      check(b.taxRate, 0.05, 0.45, 'taxRate');
      check(b.healthBudget, 0, 30, 'healthBudget');
      check(b.educationBudget, 0, 30, 'educationBudget');
      check(b.defenseBudget, 0, 1000000, 'defenseBudget');
      check(b.interestRate, 0, 0.25, 'interestRate');
    } catch (e) { return bad(res, 400, e.message); }
    const before = { taxRate: state.taxRate };
    if (b.taxRate !== undefined) state.taxRate = b.taxRate;
    if (b.healthBudget !== undefined) state.healthBudget = b.healthBudget;
    if (b.educationBudget !== undefined) state.educationBudget = b.educationBudget;
    if (b.defenseBudget !== undefined) state.defenseBudget = b.defenseBudget;
    if (b.interestRate !== undefined) state.interestRate = b.interestRate;
    if (b.taxRate !== undefined && b.taxRate > before.taxRate + 0.05) state.approval = clamp(state.approval - 2, 1, 99);
    await store.saveCountryState(state);
    await audit(req, 'policy', b);
    res.json(await enrichState(state));
  } catch (e) { console.error(e); bad(res, 500, 'Policy update failed'); }
});

app.post('/api/actions/build', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    if (onCooldown(req.user.id, 'build', 2000)) return bad(res, 429, 'One construction order every 2 seconds');
    const { project } = req.body || {};
    const def = PROJECTS[project];
    if (!def) return bad(res, 400, `Unknown project. Valid: ${Object.keys(PROJECTS).join(', ')}`);
    if (state.treasury < def.cost) return bad(res, 400, `Insufficient treasury: ${project} costs $${def.cost}M`);
    for (const [c, q] of Object.entries(def.commodities)) {
      if ((state.stockpiles[c] || 0) < q) return bad(res, 400, `Need ${q.toLocaleString()} ${c.replace(/_/g, ' ')} in stockpile for ${project}`);
    }
    state.treasury -= def.cost;
    for (const [c, q] of Object.entries(def.commodities)) state.stockpiles[c] -= q;
    const id = await store.addProject(state.code, project, tick, tick + def.ticks);
    state.projects = state.projects || [];
    state.projects.push({ id, project, status: 'in_progress', startedTick: tick, completesTick: tick + def.ticks });
    await store.saveCountryState(state);
    await audit(req, 'build', { project, cost: def.cost });
    await postNews({ category: 'economy', title: `${state.name} starts ${project} construction`, body: `${state.name} has broken ground on a ${project} project, due in ${def.ticks} days.` });
    res.status(201).json({ project: { id, project, status: 'in_progress', startedTick: tick, completesTick: tick + def.ticks }, state: await enrichState(state) });
  } catch (e) { console.error(e); bad(res, 500, 'Build failed'); }
});

app.get('/api/actions/projects', authMiddleware, async (req, res) => {
  const state = await myCountry(req, res);
  if (!state) return;
  res.json(await store.listProjects(state.code));
});

const MINISTER_ROLES = ['foreign', 'finance', 'defense', 'health', 'education', 'interior'];
app.post('/api/actions/appoint', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    const { role, name } = req.body || {};
    if (!MINISTER_ROLES.includes(role)) return bad(res, 400, `Role must be one of: ${MINISTER_ROLES.join(', ')}`);
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) return bad(res, 400, 'Minister name must be 2-60 characters');
    await store.setMinister(state.code, role, name.trim());
    state.ministers = { ...(state.ministers || {}), [role]: name.trim() };
    state.approval = clamp(state.approval + 0.5, 1, 99);
    await store.saveCountryState(state);
    await audit(req, 'appoint', { role, name: name.trim() });
    res.json(await enrichState(state));
  } catch (e) { console.error(e); bad(res, 500, 'Appointment failed'); }
});

app.get('/api/actions/ministers', authMiddleware, async (req, res) => {
  const state = await myCountry(req, res);
  if (!state) return;
  res.json({ ...state.ministers, ...(await store.getMinisters(state.code)) });
});

app.post('/api/actions/respond-event', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    const { eventId, response } = req.body || {};
    const ev = await store.getEvent(Number(eventId));
    if (!ev || ev.country_code !== state.code) return bad(res, 404, 'Event not found for your country');
    if (ev.status !== 'pending') return bad(res, 400, `Event already ${ev.status}`);
    if (!['emergency_fund', 'ignore', 'international_appeal'].includes(response)) {
      return bad(res, 400, 'response must be emergency_fund, ignore or international_appeal');
    }
    const data = safeJson(ev.data_json);
    const damage = data.damageM || 300;
    if (response === 'emergency_fund') {
      const cost = 50 * ev.severity;
      if (state.treasury < cost) return bad(res, 400, `Emergency fund needs $${cost}M`);
      state.treasury -= cost;
      state.approval = clamp(state.approval + ev.severity, 1, 99);
      for (const d of state.diseases || []) if (d.name === ev.name) d.affected = Math.round(d.affected * 0.5);
    } else if (response === 'ignore') {
      state.treasury -= damage * 0.1;
      state.approval = clamp(state.approval - ev.severity * 2, 1, 99);
    } else {
      if (state.treasury < 10) return bad(res, 400, 'International appeal needs $10M');
      state.treasury -= 10 + damage * 0.05;
      state.approval = clamp(state.approval + 0.5, 1, 99);
      state.influence = clamp((state.influence || 50) + 1, 0, 100);
    }
    await store.updateEvent(ev.id, 'resolved');
    state.events = (state.events || []).filter((e) => e.id !== ev.id);
    await store.saveCountryState(state);
    await audit(req, 'respond_event', { eventId: ev.id, response });
    res.json(await enrichState(state));
  } catch (e) { console.error(e); bad(res, 500, 'Event response failed'); }
});

// ---------------------------------------------------------------- population / health / military
app.get('/api/population', authMiddleware, async (req, res) => {
  const state = await myCountry(req, res);
  if (!state) return;
  const pop = state.population;
  res.json({
    population: pop, birthsPerDay: state.birthsPerDay, deathsPerDay: state.deathsPerDay,
    birthRate: state.birthRate, deathRate: state.deathRate, migrationNet: state.migrationNet,
    ageBands: { '0-14': Math.round(pop * 0.27), '15-64': Math.round(pop * 0.66), '65+': Math.round(pop * 0.07) },
    urbanPct: state.urbanPct, ruralPct: +(1 - state.urbanPct).toFixed(2),
    literacy: state.literacy, poverty: state.poverty, unemployment: state.unemployment,
    approval: state.approval,
  });
});

app.get('/api/health', authMiddleware, async (req, res) => {
  const state = await myCountry(req, res);
  if (!state) return;
  res.json({
    hospitals: state.hospitals, doctors: state.doctors, beds: state.beds,
    vaccination: state.vaccination, healthIndex: state.healthIndex,
    diseases: (state.diseases || []).map((d) => ({ name: d.name, affected: d.affected, severity: d.severity, trend: d.trend })),
  });
});

app.post('/api/health/vaccinate', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    const { disease } = req.body || {};
    const d = (state.diseases || []).find((x) => x.name === disease);
    if (!d) return bad(res, 404, 'No such active disease in your country');
    const cost = 50;
    if (state.treasury < cost) return bad(res, 400, `Vaccination campaign costs $${cost}M`);
    state.treasury -= cost;
    d.affected = Math.round(d.affected * 0.6);
    d.trend = 'falling';
    state.vaccination = clamp(state.vaccination + 0.02, 0, 1);
    await store.saveCountryState(state);
    await audit(req, 'vaccinate', { disease, cost });
    res.json(await enrichState(state));
  } catch (e) { console.error(e); bad(res, 500, 'Vaccination failed'); }
});

app.get('/api/military', authMiddleware, async (req, res) => {
  const state = await myCountry(req, res);
  if (!state) return;
  res.json({ personnel: state.personnel, equipment: state.equipment, readiness: state.readiness, defenseBudget: state.defenseBudget });
});

app.post('/api/military/recruit', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    const { count } = req.body || {};
    if (!isNum(count) || count < 1 || count > 100000) return bad(res, 400, 'count must be 1-100,000');
    const cost = count * 0.02; // $20k per soldier, USD millions
    if (state.treasury < cost) return bad(res, 400, `Recruiting ${count} personnel costs $${cost.toFixed(2)}M`);
    state.treasury -= cost;
    state.personnel += Math.round(count);
    state.readiness = clamp(state.readiness + 1, 0, 100);
    await store.saveCountryState(state);
    await audit(req, 'military_recruit', { count, cost });
    res.json(await enrichState(state));
  } catch (e) { console.error(e); bad(res, 500, 'Recruitment failed'); }
});

const EQUIPMENT_COST = { tanks: 5, jets: 40, ships: 120 };
app.post('/api/military/equipment', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    const { item, qty } = req.body || {};
    if (!EQUIPMENT_COST[item]) return bad(res, 400, 'item must be tanks, jets or ships');
    if (!isNum(qty) || qty < 1 || qty > 1000) return bad(res, 400, 'qty must be 1-1,000');
    const cost = EQUIPMENT_COST[item] * qty;
    if (state.treasury < cost) return bad(res, 400, `Need $${cost}M for ${qty} ${item}`);
    state.treasury -= cost;
    state.equipment[item] = (state.equipment[item] || 0) + Math.round(qty);
    state.readiness = clamp(state.readiness + 2, 0, 100);
    await store.saveCountryState(state);
    await audit(req, 'military_equipment', { item, qty, cost });
    res.json(await enrichState(state));
  } catch (e) { console.error(e); bad(res, 500, 'Equipment purchase failed'); }
});

app.post('/api/military/peacekeeping', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    const { targetCode } = req.body || {};
    const target = targetCode ? await store.getCountryState(targetCode.toUpperCase()) : null;
    if (!target || !target.presidentUserId) return bad(res, 400, 'Target country has no president');
    if (state.treasury < 100) return bad(res, 400, 'Peacekeeping mission costs $100M');
    state.treasury -= 100;
    state.influence = clamp((state.influence || 50) + 2, 0, 100);
    await store.upsertRelation(state.code, target.code, { score: clamp(((await store.getRelation(state.code, target.code)) || { score: 0 }).score + 10, -100, 100) });
    await store.saveCountryState(state);
    await audit(req, 'peacekeeping', { targetCode: target.code });
    await notifyUser(target.presidentUserId, `${state.name} sent a peacekeeping mission to ${target.name}`, 'diplomacy');
    await postNews({ category: 'diplomacy', title: `${state.name} deploys peacekeepers to ${target.name}`, body: `${state.name} has sent a peacekeeping mission to ${target.name}, improving relations.` });
    res.json(await enrichState(state));
  } catch (e) { console.error(e); bad(res, 500, 'Peacekeeping failed'); }
});

// ---------------------------------------------------------------- diplomacy
app.get('/api/diplomacy', authMiddleware, async (req, res) => {
  const state = await myCountry(req, res);
  if (!state) return;
  const relations = await store.listRelations(state.code);
  const treaties = await store.listTreaties(state.code);
  const offers = await store.listOffersForCountry(state.code);
  res.json({ relations, treaties, pendingOffers: offers.filter((o) => o.status === 'pending') });
});

app.post('/api/diplomacy/relation', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    const { toCode, action, accept } = req.body || {};
    if (!toCode || typeof toCode !== 'string') return bad(res, 400, 'toCode required');
    const to = toCode.toUpperCase();
    if (to === state.code) return bad(res, 400, 'Cannot conduct diplomacy with yourself');
    const target = await store.getCountryState(to);
    if (!target || !target.presidentUserId) return bad(res, 400, 'Target country has no president yet');
    const rel = (await store.getRelation(state.code, to)) || { score: 0, embassy: false, alliance: 'none', treaty: null, embargo: false };
    const saveRel = async (patch) => store.upsertRelation(state.code, to, { ...rel, ...patch });
    const spend = (amount) => {
      if (state.treasury < amount) throw new Error(`Insufficient treasury: need $${amount}M`);
      state.treasury -= amount;
    };
    switch (action) {
      case 'improve':
        spend(5);
        await saveRel({ score: clamp(rel.score + 5, -100, 100) });
        break;
      case 'embassy':
        if (rel.embassy) return bad(res, 400, 'Embassy already established');
        spend(20);
        await saveRel({ embassy: true, score: clamp(rel.score + 10, -100, 100) });
        break;
      case 'alliance_propose': {
        if (rel.alliance === 'allied') return bad(res, 400, 'Already allied');
        const id = await store.createTreaty(state.code, to, 'alliance');
        await notifyUser(target.presidentUserId, `${state.name} proposes an alliance`, 'diplomacy');
        await store.saveCountryState(state);
        await audit(req, 'alliance_propose', { toCode: to, treatyId: id });
        return res.json({ treatyId: id, status: 'pending' });
      }
      case 'alliance_accept': {
        if (accept !== true) return bad(res, 400, 'Pass accept:true to accept a pending alliance');
        const pending = (await store.listTreaties(state.code)).find((t) => t.kind === 'alliance' && t.status === 'pending' && t.a_code === to);
        if (!pending) return bad(res, 404, 'No pending alliance proposal from that country');
        await store.updateTreaty(pending.id, 'active');
        await saveRel({ alliance: 'allied', score: clamp(rel.score + 15, -100, 100) });
        await notifyUser(target.presidentUserId, `${state.name} accepted your alliance proposal`, 'diplomacy');
        await postNews({ category: 'diplomacy', title: `${state.name} and ${target.name} form an alliance`, body: `${state.name} and ${target.name} have signed a formal alliance.` });
        break;
      }
      case 'treaty': {
        const id = await store.createTreaty(state.code, to, 'treaty');
        await notifyUser(target.presidentUserId, `${state.name} proposes a treaty`, 'diplomacy');
        await store.saveCountryState(state);
        await audit(req, 'treaty_propose', { toCode: to, treatyId: id });
        return res.json({ treatyId: id, status: 'pending' });
      }
      case 'treaty_accept': {
        if (accept !== true) return bad(res, 400, 'Pass accept:true to accept a pending treaty');
        const pending = (await store.listTreaties(state.code)).find((t) => t.kind === 'treaty' && t.status === 'pending' && t.a_code === to);
        if (!pending) return bad(res, 404, 'No pending treaty proposal from that country');
        await store.updateTreaty(pending.id, 'active');
        await saveRel({ treaty: 'treaty', score: clamp(rel.score + 10, -100, 100) });
        await notifyUser(target.presidentUserId, `${state.name} accepted your treaty`, 'diplomacy');
        await postNews({ category: 'diplomacy', title: `${state.name} and ${target.name} sign a treaty`, body: `${state.name} and ${target.name} have signed a treaty.` });
        break;
      }
      case 'embargo':
        if (rel.embargo) return bad(res, 400, 'Embargo already in place');
        await saveRel({ embargo: true, score: clamp(rel.score - 15, -100, 100) });
        break;
      case 'embargo_lift':
        if (!rel.embargo) return bad(res, 400, 'No embargo in place');
        await saveRel({ embargo: false, score: clamp(rel.score + 5, -100, 100) });
        break;
      case 'break':
        await saveRel({ alliance: 'none', treaty: null, score: clamp(rel.score - 20, -100, 100) });
        await notifyUser(target.presidentUserId, `${state.name} broke off relations`, 'diplomacy');
        break;
      default:
        return bad(res, 400, 'action must be improve, embassy, alliance_propose, alliance_accept, treaty, treaty_accept, embargo, embargo_lift or break');
    }
    await store.saveCountryState(state);
    await audit(req, 'diplomacy_relation', { toCode: to, action });
    res.json({ relation: await store.getRelation(state.code, to), state: await enrichState(state) });
  } catch (e) {
    if (e.message && e.message.startsWith('Insufficient treasury')) return bad(res, 400, e.message);
    console.error(e); bad(res, 500, 'Diplomacy action failed');
  }
});

app.post('/api/diplomacy/message', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    const { toCode, text } = req.body || {};
    if (!toCode || typeof toCode !== 'string') return bad(res, 400, 'toCode required');
    const to = toCode.toUpperCase();
    const target = await store.getCountryState(to);
    if (!target || !target.presidentUserId) return bad(res, 400, 'Target country has no president yet');
    if (!text || typeof text !== 'string' || !text.trim() || text.length > 1000) return bad(res, 400, 'Message must be 1-1000 characters');
    const id = await store.addMessage(state.code, to, req.user.username, text.trim());
    await audit(req, 'diplomacy_message', { toCode: to });
    await notifyUser(target.presidentUserId, `Diplomatic message from ${state.name}`, 'diplomacy');
    res.status(201).json({ id, fromCode: state.code, toCode: to, text: text.trim() });
  } catch (e) { console.error(e); bad(res, 500, 'Message failed'); }
});

app.get('/api/diplomacy/messages/:code', authMiddleware, async (req, res) => {
  const state = await myCountry(req, res);
  if (!state) return;
  const other = req.params.code.toUpperCase();
  if (other === state.code) return bad(res, 400, 'Cannot message yourself');
  res.json(await store.listMessages(state.code, other));
});

// ---------------------------------------------------------------- UN
app.get('/api/un', async (req, res) => {
  res.json(await store.listResolutions());
});

app.post('/api/un/propose', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || text.trim().length < 10 || text.trim().length > 500) {
      return bad(res, 400, 'Resolution text must be 10-500 characters');
    }
    const id = await store.createResolution(state.code, text.trim());
    await audit(req, 'un_propose', { id });
    res.status(201).json({ id, proposer: state.code, text: text.trim(), votesFor: 0, votesAgainst: 0, status: 'open' });
  } catch (e) { console.error(e); bad(res, 500, 'Proposal failed'); }
});

app.post('/api/un/vote', authMiddleware, async (req, res) => {
  try {
    const state = await myCountry(req, res);
    if (!state) return;
    const { id, vote } = req.body || {};
    if (!['for', 'against'].includes(vote)) return bad(res, 400, "vote must be 'for' or 'against'");
    const resolution = await store.getResolution(Number(id));
    if (!resolution) return bad(res, 404, 'Resolution not found');
    if (resolution.status !== 'open') return bad(res, 400, `Resolution already ${resolution.status}`);
    const ok = await store.addVote(resolution.id, state.code, vote);
    if (!ok) return bad(res, 400, 'Your country has already voted on this resolution');
    await audit(req, 'un_vote', { id: resolution.id, vote });
    const updated = await store.getResolution(resolution.id);
    const claimed = (await store.listClaimedCountries()).length;
    const totalVotes = updated.votes_for + updated.votes_against;
    if (claimed > 0 && totalVotes > claimed / 2) {
      const status = updated.votes_for > updated.votes_against ? 'passed' : 'failed';
      await store.updateResolution(resolution.id, { status });
      await postNews({ category: 'politics', title: `UN resolution ${status}: "${resolution.text.slice(0, 80)}"`, body: `The UN resolution proposed by ${resolution.proposer_code} ${status} with ${updated.votes_for} for and ${updated.votes_against} against.` });
      return res.json({ ...updated, status });
    }
    res.json(updated);
  } catch (e) { console.error(e); bad(res, 500, 'Vote failed'); }
});

// ---------------------------------------------------------------- news / rankings / chat / advisors / achievements
app.get('/api/news', async (req, res) => {
  const limit = clamp(Number(req.query.limit) || 50, 1, 200);
  const rows = await store.listNews(limit);
  res.json(rows.map((n) => ({ id: n.id, tick: n.tick, gameDate: n.game_date, category: n.category, title: n.title, body: n.body })));
});

app.get('/api/rankings', async (req, res) => {
  const states = await store.getAllCountryStates();
  const top = (key, n = 10) => states
    .slice().sort((a, b) => (b[key] || 0) - (a[key] || 0)).slice(0, n)
    .map((s) => ({ code: s.code, name: s.name, value: Math.round(((s[key] || 0)) * 100) / 100, president: s.president || null }));
  res.json({
    gdp: top('gdp'), qualityOfLife: top('qualityOfLife'), education: top('educationIndex'),
    health: top('healthIndex'), infra: top('infraIndex'), influence: top('influence'), green: top('greenScore'),
  });
});

const CHAT_CHANNELS = /^(global|country:[A-Z]{2}|dm:[A-Z]{2})$/;
function chatAllowed(user, countryCode, channel) {
  if (channel === 'global') return true;
  if (channel.startsWith('country:')) return countryCode === channel.slice(8);
  if (channel.startsWith('dm:')) return countryCode !== null && countryCode !== channel.slice(3);
  return false;
}
app.get('/api/chat/:channel', authMiddleware, async (req, res) => {
  const channel = req.params.channel;
  if (!CHAT_CHANNELS.test(channel)) return bad(res, 400, 'channel must be global, country:<CODE> or dm:<CODE>');
  const countryCode = await store.countryOfUser(req.user.id);
  if (!chatAllowed(req.user, countryCode, channel)) return bad(res, 403, 'Not a member of this channel');
  const rows = await store.listChat(channel, 100);
  res.json(rows.reverse().map((m) => ({ id: m.id, channel: m.channel, from: m.username, text: m.text, at: m.created_at })));
});

app.post('/api/chat', authMiddleware, async (req, res) => {
  try {
    const { channel, text } = req.body || {};
    if (!channel || !CHAT_CHANNELS.test(channel)) return bad(res, 400, 'channel must be global, country:<CODE> or dm:<CODE>');
    const countryCode = await store.countryOfUser(req.user.id);
    if (!chatAllowed(req.user, countryCode, channel)) return bad(res, 403, 'Not a member of this channel');
    if (!text || typeof text !== 'string' || !text.trim() || text.length > CHAT_MAX) return bad(res, 400, `Message must be 1-${CHAT_MAX} characters`);
    if (onCooldown(req.user.id, 'chat', 2000)) return bad(res, 429, 'One chat message every 2 seconds');
    const id = await store.addChat(channel, req.user.id, req.user.username, text.trim());
    const msg = { id, channel, from: req.user.username, text: text.trim(), at: new Date().toISOString() };
    if (io) io.emit('chat:message', msg);
    res.status(201).json(msg);
  } catch (e) { console.error(e); bad(res, 500, 'Chat failed'); }
});

app.get('/api/advisors', authMiddleware, async (req, res) => {
  const state = await myCountry(req, res);
  if (!state) return;
  const relations = await store.listRelations(state.code);
  const pending = await store.listPendingEvents(state.code);
  const prices = await store.getPrices();
  res.json(advisors(state, relations, pending, prices));
});

app.get('/api/achievements', authMiddleware, async (req, res) => {
  const unlocked = await store.getAchievements(req.user.id);
  const have = new Set(unlocked.map((a) => a.code));
  res.json({
    unlocked: unlocked.map((a) => ({ code: a.code, name: a.name, unlockedAt: a.unlocked_at })),
    progress: ACHIEVEMENT_DEFS.map((d) => ({ code: d.code, name: d.name, unlocked: have.has(d.code) })),
  });
});

app.get('/api/me/notifications', authMiddleware, async (req, res) => {
  res.json(await store.listNotifications(req.user.id, 30));
});

// ---------------------------------------------------------------- admin
app.get('/api/admin/overview', authMiddleware, requireAdmin, async (req, res) => {
  const users = await store.listUsers();
  const states = await store.getAllCountryStates();
  const recent = await store.recentAudit(50);
  res.json({
    users, tick, gameDate, speed: TICK_SECONDS, online: [...onlineUsers.values()].map((u) => u.username),
    countries: states.map((s) => ({ code: s.code, name: s.name, president: s.president || null, treasury: Math.round(s.treasury), gdp: +s.gdp.toFixed(1), population: s.population, approval: +s.approval.toFixed(1) })),
    recentActions: recent.map((a) => ({ id: a.id, userId: a.user_id, action: a.action, payload: safeJson(a.payload), tick: a.tick, at: a.created_at })),
  });
});

app.post('/api/admin/broadcast', authMiddleware, requireAdmin, async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim() || text.length > 500) return bad(res, 400, 'Broadcast text must be 1-500 characters');
  await postNews({ category: 'announcement', title: 'Announcement from the World Administration', body: text.trim() });
  await audit(req, 'admin_broadcast', { text: text.trim() });
  res.json({ ok: true });
});

app.post('/api/admin/moderate', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const { userId, action } = req.body || {};
    const user = await store.findUserById(Number(userId));
    if (!user) return bad(res, 404, 'User not found');
    if (action === 'ban') {
      await store.setUserBanned(user.id, true);
      await store.deleteSessionsForUser(user.id);
    } else if (action === 'unban') {
      await store.setUserBanned(user.id, false);
    } else if (action === 'reset_country') {
      const code = await store.countryOfUser(user.id);
      if (!code) return bad(res, 400, 'User has no country to reset');
      const base = await store.getCountryBase(code);
      const fresh = initialState(base);
      await store.saveCountryState(fresh);
      await store.deleteSessionsForUser(user.id);
    } else {
      return bad(res, 400, "action must be ban, unban or reset_country");
    }
    await audit(req, 'admin_moderate', { userId: user.id, action });
    res.json({ ok: true });
  } catch (e) { console.error(e); bad(res, 500, 'Moderation failed'); }
});

app.post('/api/admin/speed', authMiddleware, requireAdmin, async (req, res) => {
  const { seconds } = req.body || {};
  if (!isNum(seconds) || seconds < 10 || seconds > 600) return bad(res, 400, 'seconds must be 10-600');
  TICK_SECONDS = Math.round(seconds);
  await store.setMeta('tick_seconds', String(TICK_SECONDS));
  startTickLoop();
  await audit(req, 'admin_speed', { seconds: TICK_SECONDS });
  res.json({ speed: TICK_SECONDS });
});

// Admin-only immediate tick (used by the smoke test and for manual catch-up).
app.post('/api/admin/tick', authMiddleware, requireAdmin, async (req, res) => {
  const summary = await doTick();
  res.json({ tick: summary.tick, gameDate: summary.gameDate, newsCount: summary.news.length });
});

// Fallback: serve SPA index if present, else JSON status.
app.get('/', (req, res) => {
  const index = path.join(publicDir, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.json({ game: 'WORLD PRESIDENT', status: 'ok', tick, gameDate, api: '/api/health' });
});
app.use((req, res) => bad(res, 404, 'Not found'));
app.use((err, req, res, next) => { console.error(err); bad(res, 500, 'Internal error'); });

// ---------------------------------------------------------------- tick loop
async function doTick() {
  tick += 1;
  const data = loadDataFiles();
  const summary = await runTick(store, {
    tick, commodities: data.commodities, eventTemplates: data.events,
  });
  gameDate = summary.gameDate;
  lastTickAt = Date.now();
  await store.setMeta('tick', String(tick));
  await store.setMeta('last_tick_at', String(lastTickAt));
  await broadcastWorld();
  return summary;
}

function startTickLoop() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => { doTick().catch((e) => console.error('[tick] error:', e)); }, TICK_SECONDS * 1000);
  tickTimer.unref();
}

// ---------------------------------------------------------------- sockets
function setupSockets(server) {
  io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      if (!token) return next(new Error('Missing auth token'));
      const session = await store.findSession(token);
      if (!session || new Date(session.expires_at).getTime() < Date.now()) return next(new Error('Invalid or expired token'));
      const user = await store.findUserById(session.user_id);
      if (!user || user.banned) return next(new Error('Unauthorized'));
      socket.user = user;
      socket.countryCode = await store.countryOfUser(user.id);
      next();
    } catch (e) { next(new Error('Auth failed')); }
  });
  io.on('connection', (socket) => {
    const u = socket.user;
    let entry = onlineUsers.get(u.id);
    if (!entry) { entry = { userId: u.id, username: u.username, socketIds: new Set() }; onlineUsers.set(u.id, entry); }
    entry.socketIds.add(socket.id);
    socket.join('global');
    if (socket.countryCode) socket.join(`country:${socket.countryCode}`);
    io.emit('presence', { online: [...onlineUsers.values()].map((x) => x.username) });
    socket.on('chat:send', async ({ channel, text } = {}) => {
      try {
        if (!channel || !CHAT_CHANNELS.test(channel)) return socket.emit('notify', { text: 'Invalid chat channel', kind: 'error' });
        if (!chatAllowed(u, socket.countryCode, channel)) return socket.emit('notify', { text: 'Not a member of this channel', kind: 'error' });
        if (!text || typeof text !== 'string' || !text.trim() || text.length > CHAT_MAX) return socket.emit('notify', { text: `Message must be 1-${CHAT_MAX} characters`, kind: 'error' });
        if (onCooldown(u.id, 'chat', 2000)) return socket.emit('notify', { text: 'One chat message every 2 seconds', kind: 'error' });
        const id = await store.addChat(channel, u.id, u.username, text.trim());
        const msg = { id, channel, from: u.username, text: text.trim(), at: new Date().toISOString() };
        if (channel === 'global') io.emit('chat:message', msg);
        else if (channel.startsWith('country:')) io.to(channel).emit('chat:message', msg);
        else if (channel.startsWith('dm:')) {
          const other = channel.slice(3);
          io.to(`country:${other}`).emit('chat:message', msg);
          io.to(`country:${socket.countryCode}`).emit('chat:message', msg);
        }
      } catch (e) { console.error('[socket chat]', e); }
    });
    socket.on('disconnect', () => {
      const e2 = onlineUsers.get(u.id);
      if (e2) {
        e2.socketIds.delete(socket.id);
        if (!e2.socketIds.size) onlineUsers.delete(u.id);
      }
      io.emit('presence', { online: [...onlineUsers.values()].map((x) => x.username) });
    });
  });
}

// ---------------------------------------------------------------- boot
async function boot() {
  await store.init();
  const seeded = await seedIfEmpty(store);
  const savedTick = Number((await store.getMeta('tick')) || 0);
  const savedSpeed = Number((await store.getMeta('tick_seconds')) || 0);
  if (savedSpeed >= 10 && savedSpeed <= 600) TICK_SECONDS = savedSpeed;
  tick = savedTick;
  gameDate = gameDateFor(tick);
  const lastTickStored = Number((await store.getMeta('last_tick_at')) || 0);
  if (lastTickStored > 0) lastTickAt = lastTickStored;

  const server = http.createServer(app);
  setupSockets(server);
  await new Promise((resolve) => server.listen(PORT, '0.0.0.0', resolve));
  console.log(`[world-president] listening on :${PORT} (backend=${store.backend}, tick=${TICK_SECONDS}s, countries=${seeded.countries.length})`);

  // Catch-up ticks for elapsed time (cap 240), then start the loop.
  if (lastTickStored > 0) {
    const elapsedTicks = Math.floor((Date.now() - lastTickStored) / (TICK_SECONDS * 1000));
    const catchUp = clamp(elapsedTicks, 0, 240);
    if (catchUp > 0) {
      console.log(`[world-president] catch-up: running ${catchUp} ticks`);
      for (let i = 0; i < catchUp; i++) {
        try { await doTick(); } catch (e) { console.error('[catch-up tick] error:', e); break; }
      }
    }
  }
  await store.setMeta('last_tick_at', String(Date.now()));
  lastTickAt = Date.now();
  startTickLoop();
  return { server, app, store };
}

if (require.main === module) {
  boot().catch((e) => { console.error('[boot] fatal:', e); process.exit(1); });
}

module.exports = { app, boot, store };
