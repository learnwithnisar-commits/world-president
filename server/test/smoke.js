'use strict';
/**
 * Smoke test (plain node, no framework). Boots the real server on a temp
 * port with a temp SQLite DB, then exercises:
 * register x2, claim x2, policy change, market buy, trade offer + accept,
 * forced tick, server restart + persistence check, and 2 Socket.io clients
 * verifying each sees the other's chat message. Exits 0 on success, 1 on failure.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io } = require('socket.io-client');

const PORT = 3457;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-smoke-'));
const DB_PATH = path.join(tmpDir, 'world.db');
const SERVER = path.join(__dirname, '..', 'src', 'server.js');

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== undefined ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function req(method, p, token, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  return { status: res.status, json, text };
}

function startServer() {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT), DB_PATH, TICK_SECONDS: '600' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[server:err] ${d}`));
  return child;
}

async function waitHealthy(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve(); }, 5000);
    child.once('exit', () => { clearTimeout(t); resolve(); });
  });
}

async function main() {
  let server = startServer();
  check('server boots', await waitHealthy(), `port ${PORT}`);

  // --- register 2 users (first = admin)
  const u1 = await req('POST', '/api/auth/register', null, { username: 'president_a', email: 'a@test.local', password: 'secret123' });
  check('register user1', u1.status === 201 && !!u1.json.token, JSON.stringify(u1.json && u1.json.user));
  check('first user is admin', u1.json && u1.json.user && u1.json.user.is_admin === true);
  const u2 = await req('POST', '/api/auth/register', null, { username: 'president_b', email: 'b@test.local', password: 'secret123' });
  check('register user2', u2.status === 201 && !!u2.json.token);
  check('second user is not admin', u2.json && u2.json.user && u2.json.user.is_admin === false);
  const t1 = u1.json.token;
  const t2 = u2.json.token;

  // --- claim 2 countries
  const c1 = await req('POST', '/api/countries/claim', t1, { code: 'PK' });
  check('user1 claims PK', c1.status === 200 && c1.json.country && c1.json.country.code === 'PK', c1.text.slice(0, 200));
  const c2 = await req('POST', '/api/countries/claim', t2, { code: 'IN' });
  check('user2 claims IN', c2.status === 200 && c2.json.country && c2.json.country.code === 'IN');
  const dup = await req('POST', '/api/countries/claim', t2, { code: 'PK' });
  check('cannot claim second country', dup.status === 400);

  // --- policy change
  const pol = await req('POST', '/api/actions/policy', t1, { taxRate: 0.20, healthBudget: 10 });
  check('policy change applies', pol.status === 200 && pol.json.taxRate === 0.20 && pol.json.healthBudget === 10, pol.text.slice(0, 200));
  const badPol = await req('POST', '/api/actions/policy', t1, { taxRate: 0.99 });
  check('policy range rejected', badPol.status === 400 || badPol.status === 429);

  // --- market buy
  const before = await req('GET', '/api/me/country', t1);
  const buy = await req('POST', '/api/market/buy', t1, { commodity: 'oil', qty: 1000 });
  check('market buy oil', buy.status === 200 && buy.json.state.stockpiles.oil === (before.json.stockpiles.oil + 1000), buy.text.slice(0, 200));
  check('market buy deducts treasury', buy.status === 200 && buy.json.state.treasury < before.json.treasury);

  // --- trade offer + accept
  const inBefore = await req('GET', '/api/me/country', t2);
  const offer = await req('POST', '/api/trade/offer', t1, { toCode: 'IN', commodity: 'wheat', qty: 1000, pricePerUnit: 250 });
  check('trade offer created', offer.status === 201 && !!offer.json.id, offer.text.slice(0, 200));
  const offers = await req('GET', '/api/trade/offers', t2);
  check('offer visible to recipient', offers.status === 200 && offers.json.some((o) => o.id === offer.json.id));
  const accept = await req('POST', '/api/trade/respond', t2, { offerId: offer.json.id, accept: true });
  check('trade offer accepted', accept.status === 200 && accept.json.status === 'accepted', accept.text.slice(0, 300));
  const afterTrade = await req('GET', '/api/me/country', t2);
  check('buyer stockpile increased', afterTrade.json.stockpiles.wheat === inBefore.json.stockpiles.wheat + 1000,
    `wheat before=${inBefore.json.stockpiles.wheat} after=${afterTrade.json.stockpiles.wheat}`);

  // --- forced tick (admin)
  const tickRes = await req('POST', '/api/admin/tick', t1, {});
  check('admin forced tick', tickRes.status === 200 && tickRes.json.tick >= 1, JSON.stringify(tickRes.json));
  const tickState = await req('GET', '/api/me/country', t1);
  check('tick advanced game date', tickState.json && tickState.json.code === 'PK');
  const oilAfterTick = tickState.json.stockpiles.oil;

  // --- advisors + rankings + news (read-only sanity)
  const adv = await req('GET', '/api/advisors', t1);
  check('advisors return briefing', adv.status === 200 && Array.isArray(adv.json.economy) && adv.json.economy.length > 0);
  const rank = await req('GET', '/api/rankings');
  check('rankings return lists', rank.status === 200 && Array.isArray(rank.json.gdp) && rank.json.gdp.length > 0);
  const news = await req('GET', '/api/news?limit=10');
  check('news has real entries', news.status === 200 && Array.isArray(news.json) && news.json.length > 0);

  // --- restart + persistence
  const treasuryBefore = tickState.json.treasury;
  await stopServer(server);
  server = startServer();
  check('server restarts', await waitHealthy());
  const meAfter = await req('GET', '/api/auth/me', t1);
  check('session survives restart', meAfter.status === 200 && meAfter.json.countryCode === 'PK', meAfter.text.slice(0, 200));
  // Regression: login with username+password must work AFTER a restart
  // (normalizeUser once stripped password_hash, so bcrypt.compare got undefined).
  const loginAfter = await req('POST', '/api/auth/login', null, { username: 'president_a', password: 'secret123' });
  check('login works after restart', loginAfter.status === 200 && !!loginAfter.json.token, loginAfter.text.slice(0, 200));
  const badLogin = await req('POST', '/api/auth/login', null, { username: 'president_a', password: 'wrongpass' });
  check('wrong password rejected', badLogin.status === 401, badLogin.text.slice(0, 200));
  const stateAfter = await req('GET', '/api/me/country', t1);
  check('state persisted across restart', stateAfter.status === 200 && Math.abs(stateAfter.json.treasury - treasuryBefore) < 500,
    `treasury before=${treasuryBefore} after=${stateAfter.json && stateAfter.json.treasury}`);
  check('stockpile persisted', stateAfter.json.stockpiles.oil === oilAfterTick,
    `oil after tick=${oilAfterTick} after restart=${stateAfter.json && stateAfter.json.stockpiles.oil}`);

  // --- sockets: 2 clients, chat round-trip
  const s1 = io(BASE, { auth: { token: t1 }, reconnection: false });
  const s2 = io(BASE, { auth: { token: t2 }, reconnection: false });
  await new Promise((resolve, reject) => {
    let connected = 0;
    const done = () => { if (++connected === 2) resolve(); };
    s1.on('connect', done);
    s2.on('connect', done);
    s1.on('connect_error', reject);
    s2.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket connect timeout')), 10000);
  });
  check('both socket clients connect', true);
  const chatPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('chat message not received')), 10000);
    s2.on('chat:message', (msg) => {
      if (msg.from === 'president_a' && msg.text === 'Hello from PK!') { clearTimeout(t); resolve(msg); }
    });
  });
  s1.emit('chat:send', { channel: 'global', text: 'Hello from PK!' });
  const received = await chatPromise;
  check('client2 receives client1 chat', !!received, JSON.stringify(received));
  s1.disconnect();
  s2.disconnect();

  await stopServer(server);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(failures === 0 ? '\nSMOKE TEST: ALL PASS' : `\nSMOKE TEST: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('SMOKE TEST CRASH:', e);
  process.exit(1);
});
