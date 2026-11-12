'use strict';
/**
 * Store abstraction (ARCHITECTURE.md authority).
 * - DATABASE_URL set    -> Postgres via pg Pool (Supabase connection string).
 * - DATABASE_URL unset  -> local SQLite via node:sqlite, file DB_PATH or
 *                          <project-root>/world.db.
 * Same async method signatures on both backends. All SQL is written with `?`
 * placeholders and translated to $1..$n for Postgres. Schema lives in
 * schema.sql (Postgres flavour, translated for SQLite on boot).
 */
const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function sqliteSchema(sql) {
  return sql
    .replace(/SERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/BIGSERIAL PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/JSONB/g, 'TEXT')
    .replace(/TIMESTAMPTZ/g, 'TEXT')
    .replace(/BIGINT/g, 'INTEGER');
}

function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const nowIso = () => new Date().toISOString();
const bool = (v) => (v === true || v === 1 || v === 't' || v === 'true' ? true : false);

// ---------------------------------------------------------------- SQLite
class SqliteDb {
  constructor(file) {
    const { DatabaseSync } = require('node:sqlite');
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec(sqliteSchema(fs.readFileSync(SCHEMA_PATH, 'utf8')));
  }
  async all(sql, params = []) {
    return this.db.prepare(sql).all(...params).map((r) => ({ ...r }));
  }
  async get(sql, params = []) {
    const r = this.db.prepare(sql).get(...params);
    return r ? { ...r } : null;
  }
  async run(sql, params = []) {
    const info = this.db.prepare(sql).run(...params);
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }
  async insert(sql, params = []) {
    const info = this.db.prepare(sql).run(...params);
    return Number(info.lastInsertRowid);
  }
}

// ---------------------------------------------------------------- Postgres
class PgDb {
  constructor(url) {
    const { Pool } = require('pg');
    this.pool = new Pool({ connectionString: url, max: 10, ssl: { rejectUnauthorized: false } });
  }
  async init() {
    await this.pool.query(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  }
  async all(sql, params = []) {
    const r = await this.pool.query(toPgPlaceholders(sql), params);
    return r.rows;
  }
  async get(sql, params = []) {
    const rows = await this.all(sql, params);
    return rows[0] || null;
  }
  async run(sql, params = []) {
    const r = await this.pool.query(toPgPlaceholders(sql), params);
    return { changes: r.rowCount, lastInsertRowid: null };
  }
  async insert(sql, params = []) {
    const returning = /RETURNING\s+id/i.test(sql) ? sql : `${sql} RETURNING id`;
    const r = await this.pool.query(toPgPlaceholders(returning), params);
    return r.rows[0] ? Number(r.rows[0].id) : null;
  }
  async close() { await this.pool.end(); }
}

// ---------------------------------------------------------------- Store
function createStore() {
  const dbUrl = process.env.DATABASE_URL;
  const db = dbUrl
    ? new PgDb(dbUrl)
    : new SqliteDb(process.env.DB_PATH || path.join(__dirname, '..', '..', 'world.db'));

  const store = {
    backend: dbUrl ? 'postgres' : 'sqlite',
    async init() { if (db.init) await db.init(); },
    async close() { if (db.close) await db.close(); },

    // ---- meta
    async getMeta(key) {
      const r = await db.get('SELECT value FROM game_meta WHERE key = ?', [key]);
      return r ? r.value : null;
    },
    async setMeta(key, value) {
      await db.run(
        `INSERT INTO game_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, String(value)]);
    },

    // ---- world reset (pre-launch repair only; see seed.js)
    // Wipes every world-state table but NEVER users/sessions, so no player
    // account is ever lost. Callers must gate this on countUsers() === 0.
    async resetWorld() {
      const tables = ['countries', 'country_state', 'market_prices', 'trades',
        'offers', 'relations', 'treaties', 'un_resolutions', 'un_votes',
        'news', 'chat', 'notifications', 'achievements', 'events',
        'ministers', 'projects', 'messages', 'audit'];
      for (const t of tables) await db.run(`DELETE FROM ${t}`);
      await db.run(`DELETE FROM game_meta WHERE key IN
        ('event_templates','commodities','seeded_at','seed_source',
         'tick','last_tick_at')`);
    },

    // ---- users
    async countUsers() {
      const r = await db.get('SELECT COUNT(*) AS n FROM users');
      return Number(r.n);
    },
    async createUser(username, email, passwordHash, isAdmin) {
      return db.insert(
        'INSERT INTO users (username, email, password_hash, is_admin, banned, created_at) VALUES (?, ?, ?, ?, 0, ?)',
        [username, email, passwordHash, isAdmin ? 1 : 0, nowIso()]);
    },
    async findUserByLogin(login) {
      const r = await db.get(
        'SELECT * FROM users WHERE username = ? OR email = ?', [login, login]);
      return r ? normalizeUser(r) : null;
    },
    async findUserById(id) {
      const r = await db.get('SELECT * FROM users WHERE id = ?', [id]);
      return r ? normalizeUser(r) : null;
    },
    async findUserByUsername(username) {
      const r = await db.get('SELECT * FROM users WHERE username = ?', [username]);
      return r ? normalizeUser(r) : null;
    },
    async listUsers() {
      const rows = await db.all('SELECT id, username, email, is_admin, banned, created_at FROM users ORDER BY id');
      return rows.map(normalizeUser);
    },
    async setUserBanned(id, banned) {
      await db.run('UPDATE users SET banned = ? WHERE id = ?', [banned ? 1 : 0, id]);
    },

    // ---- sessions
    async createSession(token, userId, expiresAt) {
      await db.run('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
        [token, userId, expiresAt, nowIso()]);
    },
    async findSession(token) {
      return db.get('SELECT * FROM sessions WHERE token = ?', [token]);
    },
    async deleteSession(token) {
      await db.run('DELETE FROM sessions WHERE token = ?', [token]);
    },
    async deleteSessionsForUser(userId) {
      await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    },

    // ---- countries
    async countCountries() {
      const r = await db.get('SELECT COUNT(*) AS n FROM countries');
      return Number(r.n);
    },
    async seedCountry(base, state) {
      await db.run(
        `INSERT INTO countries (code, name, name_ur, capital, flag, region, government, currency, currency_symbol, lat, lng, base_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO NOTHING`,
        [base.code, base.name, base.nameUr || null, base.capital, base.flag, base.region,
         base.government, base.currency, base.currencySymbol, base.lat ?? null, base.lng ?? null,
         JSON.stringify(base)]);
      await db.run(
        `INSERT INTO country_state (code, president_user_id, state_json, treasury, gdp, population, approval, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO NOTHING`,
        [base.code, JSON.stringify(state), state.treasury, state.gdp, state.population, state.approval, nowIso()]);
    },
    async listCountryBase() {
      const rows = await db.all('SELECT * FROM countries ORDER BY name');
      return rows.map((r) => ({ ...JSON.parse(r.base_json) }));
    },
    async getCountryBase(code) {
      const r = await db.get('SELECT base_json FROM countries WHERE code = ?', [code.toUpperCase()]);
      return r ? JSON.parse(r.base_json) : null;
    },
    async getCountryState(code) {
      const r = await db.get('SELECT * FROM country_state WHERE code = ?', [code.toUpperCase()]);
      if (!r) return null;
      const state = JSON.parse(r.state_json);
      state.presidentUserId = r.president_user_id;
      return state;
    },
    async getAllCountryStates() {
      const rows = await db.all('SELECT * FROM country_state');
      return rows.map((r) => {
        const s = JSON.parse(r.state_json);
        s.presidentUserId = r.president_user_id;
        return s;
      });
    },
    async saveCountryState(state) {
      await db.run(
        `UPDATE country_state SET president_user_id = ?, state_json = ?, treasury = ?, gdp = ?, population = ?, approval = ?, updated_at = ?
         WHERE code = ?`,
        [state.presidentUserId ?? null, JSON.stringify(state), state.treasury, state.gdp,
         Math.round(state.population), state.approval, nowIso(), state.code]);
    },
    async claimCountry(code, userId, username) {
      const state = await store.getCountryState(code);
      if (!state || state.presidentUserId) return null;
      state.president = username;
      state.presidentUserId = userId;
      await store.saveCountryState(state);
      return state;
    },
    async countryOfUser(userId) {
      const r = await db.get('SELECT code FROM country_state WHERE president_user_id = ?', [userId]);
      return r ? r.code : null;
    },
    async listClaimedCountries() {
      const rows = await db.all('SELECT code, president_user_id FROM country_state WHERE president_user_id IS NOT NULL');
      return rows;
    },

    // ---- market prices
    async seedPrice(commodity, price) {
      await db.run(
        `INSERT INTO market_prices (commodity, price, prev_price, supply, demand) VALUES (?, ?, ?, 0, 0)
         ON CONFLICT(commodity) DO NOTHING`, [commodity, price, price]);
    },
    async getPrices() {
      const rows = await db.all('SELECT * FROM market_prices ORDER BY commodity');
      const out = {};
      for (const r of rows) out[r.commodity] = { price: r.price, prevPrice: r.prev_price, supply: r.supply, demand: r.demand };
      return out;
    },
    async setPrice(commodity, price, prevPrice, supply, demand) {
      await db.run(
        `INSERT INTO market_prices (commodity, price, prev_price, supply, demand) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(commodity) DO UPDATE SET price = excluded.price, prev_price = excluded.prev_price,
         supply = excluded.supply, demand = excluded.demand`,
        [commodity, price, prevPrice, supply, demand]);
    },

    // ---- trades / offers
    async addTrade(t) {
      return db.insert(
        'INSERT INTO trades (tick, seller_code, buyer_code, commodity, qty, price_per_unit, total, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [t.tick || 0, t.sellerCode || null, t.buyerCode || null, t.commodity, t.qty, t.pricePerUnit, t.total, t.kind, nowIso()]);
    },
    async createOffer(o) {
      return db.insert(
        'INSERT INTO offers (from_code, to_code, commodity, qty, price_per_unit, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [o.fromCode, o.toCode, o.commodity, o.qty, o.pricePerUnit, 'pending', nowIso(), nowIso()]);
    },
    async getOffer(id) {
      return db.get('SELECT * FROM offers WHERE id = ?', [id]);
    },
    async listOffersForCountry(code) {
      return db.all('SELECT * FROM offers WHERE from_code = ? OR to_code = ? ORDER BY id DESC LIMIT 100', [code, code]);
    },
    async updateOffer(id, status) {
      await db.run('UPDATE offers SET status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), id]);
    },

    // ---- relations / treaties
    async getRelation(a, b) {
      const [x, y] = [a, b].sort();
      return db.get('SELECT * FROM relations WHERE a_code = ? AND b_code = ?', [x, y]);
    },
    async upsertRelation(a, b, fields) {
      const [x, y] = [a, b].sort();
      const existing = await store.getRelation(a, b);
      const merged = { score: 0, embassy: false, alliance: 'none', treaty: null, embargo: false, ...(existing || {}), ...fields };
      // When stored sorted, score/embassy are symmetric; alliance/treaty stored once.
      if (existing) {
        await db.run(
          'UPDATE relations SET score = ?, embassy = ?, alliance = ?, treaty = ?, embargo = ?, updated_at = ? WHERE a_code = ? AND b_code = ?',
          [merged.score, merged.embassy ? 1 : 0, merged.alliance, merged.treaty, merged.embargo ? 1 : 0, nowIso(), x, y]);
      } else {
        await db.insert(
          'INSERT INTO relations (a_code, b_code, score, embassy, alliance, treaty, embargo, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [x, y, merged.score, merged.embassy ? 1 : 0, merged.alliance, merged.treaty, merged.embargo ? 1 : 0, nowIso()]);
      }
      return merged;
    },
    async listRelations(code) {
      const rows = await db.all('SELECT * FROM relations WHERE a_code = ? OR b_code = ?', [code, code]);
      return rows.map((r) => ({
        code: r.a_code === code ? r.b_code : r.a_code,
        score: r.score, embassy: bool(r.embassy), alliance: r.alliance, treaty: r.treaty, embargo: bool(r.embargo),
      }));
    },
    async createTreaty(a, b, kind) {
      return db.insert('INSERT INTO treaties (a_code, b_code, kind, status, created_at) VALUES (?, ?, ?, ?, ?)',
        [a, b, kind, 'pending', nowIso()]);
    },
    async getTreaty(id) {
      return db.get('SELECT * FROM treaties WHERE id = ?', [id]);
    },
    async listTreaties(code) {
      return db.all('SELECT * FROM treaties WHERE a_code = ? OR b_code = ? ORDER BY id DESC LIMIT 50', [code, code]);
    },
    async updateTreaty(id, status) {
      await db.run('UPDATE treaties SET status = ? WHERE id = ?', [status, id]);
    },

    // ---- UN
    async createResolution(proposerCode, text) {
      return db.insert('INSERT INTO un_resolutions (proposer_code, text, status, votes_for, votes_against, created_at) VALUES (?, ?, ?, 0, 0, ?)',
        [proposerCode, text, 'open', nowIso()]);
    },
    async listResolutions() {
      return db.all('SELECT * FROM un_resolutions ORDER BY id DESC LIMIT 50');
    },
    async getResolution(id) {
      return db.get('SELECT * FROM un_resolutions WHERE id = ?', [id]);
    },
    async addVote(resolutionId, countryCode, vote) {
      try {
        await db.insert('INSERT INTO un_votes (resolution_id, country_code, vote) VALUES (?, ?, ?)',
          [resolutionId, countryCode, vote]);
      } catch (e) {
        if (/UNIQUE|duplicate/i.test(e.message)) return false;
        throw e;
      }
      await db.run(`UPDATE un_resolutions SET ${vote === 'for' ? 'votes_for' : 'votes_against'} = ${vote === 'for' ? 'votes_for' : 'votes_against'} + 1 WHERE id = ?`,
        [resolutionId]);
      return true;
    },
    async updateResolution(id, fields) {
      const sets = [];
      const params = [];
      if (fields.status) { sets.push('status = ?'); params.push(fields.status); }
      if (sets.length) await db.run(`UPDATE un_resolutions SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    },

    // ---- news / chat / notifications
    async addNews(item) {
      return db.insert('INSERT INTO news (tick, game_date, category, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [item.tick || 0, item.gameDate || null, item.category || 'general', item.title, item.body || '', nowIso()]);
    },
    async listNews(limit = 50) {
      return db.all('SELECT * FROM news ORDER BY id DESC LIMIT ?', [limit]);
    },
    async addChat(channel, userId, username, text) {
      return db.insert('INSERT INTO chat (channel, user_id, username, text, created_at) VALUES (?, ?, ?, ?, ?)',
        [channel, userId, username, text, nowIso()]);
    },
    async listChat(channel, limit = 100) {
      return db.all('SELECT * FROM chat WHERE channel = ? ORDER BY id DESC LIMIT ?', [channel, limit]);
    },
    async addNotification(userId, text, kind) {
      return db.insert('INSERT INTO notifications (user_id, text, kind, read, created_at) VALUES (?, ?, ?, 0, ?)',
        [userId, text, kind || 'info', nowIso()]);
    },
    async listNotifications(userId, limit = 30) {
      return db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?', [userId, limit]);
    },

    // ---- diplomacy messages
    async addMessage(fromCode, toCode, fromUser, text) {
      return db.insert('INSERT INTO messages (from_code, to_code, from_user, text, created_at) VALUES (?, ?, ?, ?, ?)',
        [fromCode, toCode, fromUser, text, nowIso()]);
    },
    async listMessages(a, b) {
      return db.all(
        'SELECT * FROM messages WHERE (from_code = ? AND to_code = ?) OR (from_code = ? AND to_code = ?) ORDER BY id ASC LIMIT 200',
        [a, b, b, a]);
    },

    // ---- ministers / projects / events / achievements
    async getMinisters(code) {
      const rows = await db.all('SELECT role, name FROM ministers WHERE country_code = ?', [code]);
      const out = {};
      for (const r of rows) out[r.role] = r.name;
      return out;
    },
    async setMinister(code, role, name) {
      await db.run(
        `INSERT INTO ministers (country_code, role, name) VALUES (?, ?, ?)
         ON CONFLICT(country_code, role) DO UPDATE SET name = excluded.name`, [code, role, name]);
    },
    async addProject(code, project, startedTick, completesTick) {
      return db.insert('INSERT INTO projects (country_code, project, status, started_tick, completes_tick, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [code, project, 'in_progress', startedTick, completesTick, nowIso()]);
    },
    async listProjects(code) {
      return db.all('SELECT * FROM projects WHERE country_code = ? ORDER BY id DESC LIMIT 100', [code]);
    },
    async updateProject(id, status) {
      await db.run('UPDATE projects SET status = ? WHERE id = ?', [status, id]);
    },
    async addPendingEvent(code, tpl, severity, tick, data) {
      return db.insert(
        'INSERT INTO events (country_code, template_id, name, severity, status, tick, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [code, tpl.id, tpl.name, severity, 'pending', tick, JSON.stringify(data || {}), nowIso()]);
    },
    async listPendingEvents(code) {
      return db.all("SELECT * FROM events WHERE country_code = ? AND status = 'pending' ORDER BY id DESC", [code]);
    },
    async updateEvent(id, status) {
      await db.run('UPDATE events SET status = ? WHERE id = ?', [status, id]);
    },
    async getEvent(id) {
      return db.get('SELECT * FROM events WHERE id = ?', [id]);
    },
    async getAchievements(userId) {
      return db.all('SELECT * FROM achievements WHERE user_id = ? ORDER BY id', [userId]);
    },
    async unlockAchievement(userId, code, name) {
      try {
        return await db.insert('INSERT INTO achievements (user_id, code, name, unlocked_at) VALUES (?, ?, ?, ?)',
          [userId, code, name, nowIso()]);
      } catch (e) {
        if (/UNIQUE|duplicate/i.test(e.message)) return null;
        throw e;
      }
    },

    // ---- audit
    async logAudit(userId, action, payload, tick) {
      await db.insert('INSERT INTO audit (user_id, action, payload, tick, created_at) VALUES (?, ?, ?, ?, ?)',
        [userId || null, action, JSON.stringify(payload || {}), tick || 0, nowIso()]);
    },
    async recentAudit(limit = 50) {
      return db.all('SELECT * FROM audit ORDER BY id DESC LIMIT ?', [limit]);
    },
  };
  return store;
}

function normalizeUser(r) {
  return {
    id: r.id, username: r.username, email: r.email,
    // password_hash is kept INTERNAL ONLY (needed by login's bcrypt.compare).
    // It never leaves the server: API responses go through publicUser() in server.js.
    password_hash: r.password_hash,
    is_admin: bool(r.is_admin), banned: bool(r.banned), created_at: r.created_at,
  };
}

module.exports = { createStore };
