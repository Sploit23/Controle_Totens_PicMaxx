const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || './data/controle.db';

function initDatabase() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS totems (
      id TEXT PRIMARY KEY,
      name TEXT,
      last_seen TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS codes (
      id TEXT PRIMARY KEY,
      totem_id TEXT,
      photos INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT DEFAULT (datetime('now', '+60 minutes')),
      used INTEGER DEFAULT 0,
      used_at TEXT,
      FOREIGN KEY (totem_id) REFERENCES totems(id)
    );

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (code_id) REFERENCES codes(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_id TEXT,
      totem_id TEXT,
      total_value REAL DEFAULT 0,
      items TEXT DEFAULT '[]',
      payment_method TEXT DEFAULT 'qr_code',
      status TEXT DEFAULT 'completed',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (code_id) REFERENCES codes(id),
      FOREIGN KEY (totem_id) REFERENCES totems(id)
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT DEFAULT 'basic',
      created_at TEXT DEFAULT (datetime('now')),
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      totem_id TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      active INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Migrations: add colunas novas (ignora se ja existem)
  try { db.exec(`ALTER TABLE transactions ADD COLUMN local_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE transactions ADD COLUMN is_test INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE transactions ADD COLUMN error_reason TEXT`); } catch {}
  try { db.exec(`ALTER TABLE totems ADD COLUMN user_id INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE totems ADD COLUMN reported_config TEXT`); } catch {}
  try { db.exec(`ALTER TABLE transactions ADD COLUMN coupon_code TEXT`); } catch {}
  try { db.exec(`ALTER TABLE transactions ADD COLUMN coupon_photo_size TEXT`); } catch {}
  try { db.exec(`ALTER TABLE coupons ADD COLUMN quantity INTEGER DEFAULT 1`); } catch {}

  // Telemetry para monitoramento ao vivo
  db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      totem_id TEXT NOT NULL,
      cpu TEXT,
      ram TEXT,
      paper_10x15 TEXT,
      paper_15x20 TEXT,
      printer_error TEXT,
      printer_name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS screenshots (
      totem_id TEXT PRIMARY KEY,
      screenshot TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      code TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      discount_type TEXT DEFAULT 'free_photo',
      discount_value REAL DEFAULT 100,
      quantity INTEGER DEFAULT 1,
      size_allowed TEXT DEFAULT 'both',
      expires_at TEXT,
      max_uses INTEGER,
      max_uses_per_cpf INTEGER DEFAULT 1,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS coupon_totems (
      coupon_id INTEGER NOT NULL,
      totem_id TEXT NOT NULL,
      PRIMARY KEY (coupon_id, totem_id),
      FOREIGN KEY (coupon_id) REFERENCES coupons(id),
      FOREIGN KEY (totem_id) REFERENCES totems(id)
    );
    CREATE TABLE IF NOT EXISTS coupon_usages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coupon_id INTEGER NOT NULL,
      cpf TEXT NOT NULL,
      totem_id TEXT,
      transaction_id TEXT,
      photo_size TEXT,
      used_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (coupon_id) REFERENCES coupons(id)
    );
    CREATE TABLE IF NOT EXISTS notification_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      totem_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      alert_value TEXT,
      sent_at TEXT DEFAULT (datetime('now'))
    );
  `);

  return db;
}

const db = initDatabase();

// Funcoes internas (para uso dentro do modulo)
function _ensureCode(codeId, totemId) {
  db.prepare(`INSERT OR IGNORE INTO codes (id, totem_id, expires_at) VALUES (?, ?, datetime('now', '+1 hours'))`).run(codeId, totemId || null);
}

function _hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function _verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const verify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === verify;
}

module.exports = {
  db,
  getDB: () => db,

  // ---- Totens ----
  registerTotem(id, name) {
    db.prepare(`INSERT OR IGNORE INTO totems (id, name) VALUES (?, ?)`).run(id, name || id);
    db.prepare(`UPDATE totems SET last_seen = datetime('now') WHERE id = ?`).run(id);
  },

  getTotems() {
    return db.prepare(`SELECT * FROM totems ORDER BY name`).all();
  },

  getTotem(id) {
    return db.prepare(`SELECT * FROM totems WHERE id = ?`).get(id);
  },

  updateTotemName(id, name) {
    db.prepare(`UPDATE totems SET name = ? WHERE id = ?`).run(name, id);
  },

  updateTotemConfig(id, configJson) {
    db.prepare(`UPDATE totems SET reported_config = ? WHERE id = ?`).run(configJson, id);
  },

  getTotemConfig(id) {
    const t = db.prepare(`SELECT reported_config FROM totems WHERE id = ?`).get(id);
    if (!t || !t.reported_config) return {};
    try { return JSON.parse(t.reported_config); } catch { return {}; }
  },

  // ---- Codigos (registro dos codigos usados nas transacoes) ----
  ensureCode: _ensureCode,

  // ---- Transacoes ----
  createTransaction(codeId, totalValue, items, totemId, paymentMethod, localId = null, isTest = 0) {
    _ensureCode(codeId, totemId);
    const result = db.prepare(`INSERT INTO transactions (code_id, totem_id, total_value, items, payment_method, local_id, is_test) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(codeId, totemId || null, totalValue, JSON.stringify(items || []), paymentMethod || 'unknown', localId, isTest ? 1 : 0);
    return result.lastInsertRowid;
  },

  createFailedTransaction(codeId, totalValue, items, totemId, paymentMethod, errorReason, localId = null, isTest = 0) {
    const safeCodeId = codeId || 'FAILED_' + Date.now();
    _ensureCode(safeCodeId, totemId);
    const result = db.prepare(`INSERT INTO transactions (code_id, totem_id, total_value, items, payment_method, status, error_reason, local_id, is_test) VALUES (?, ?, ?, ?, ?, 'failed', ?, ?, ?)`).run(safeCodeId, totemId || null, totalValue || 0, JSON.stringify(items || []), paymentMethod || 'unknown', errorReason || '', localId, isTest ? 1 : 0);
    return result.lastInsertRowid;
  },

  getTransactions(limit = 50, totemId = null) {
    if (totemId) return db.prepare(`SELECT * FROM transactions WHERE totem_id = ? ORDER BY created_at DESC LIMIT ?`).all(totemId, limit);
    return db.prepare(`SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?`).all(limit);
  },

  // ---- Stats ----
  getStats(totemId = null) {
    const params = totemId ? [totemId] : [];

    const totalSales = totemId
      ? db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(CASE WHEN is_test = 0 THEN total_value ELSE 0 END),0) as revenue FROM transactions WHERE status = 'completed' AND totem_id = ?`).get(totemId)
      : db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(CASE WHEN is_test = 0 THEN total_value ELSE 0 END),0) as revenue FROM transactions WHERE status = 'completed'`).get();

    const todaySales = totemId
      ? db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(CASE WHEN is_test = 0 THEN total_value ELSE 0 END),0) as revenue FROM transactions WHERE status = 'completed' AND totem_id = ? AND date(created_at) = date('now')`).get(totemId)
      : db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(CASE WHEN is_test = 0 THEN total_value ELSE 0 END),0) as revenue FROM transactions WHERE status = 'completed' AND date(created_at) = date('now')`).get();

    const activeCodes = totemId
      ? db.prepare(`SELECT COUNT(*) as count FROM codes WHERE used = 0 AND expires_at > datetime('now') AND totem_id = ?`).get(totemId)
      : db.prepare(`SELECT COUNT(*) as count FROM codes WHERE used = 0 AND expires_at > datetime('now')`).get();

    const totalPhotos = totemId
      ? db.prepare(`SELECT COUNT(*) as count FROM photos WHERE code_id IN (SELECT id FROM codes WHERE totem_id = ?)`).get(totemId)
      : db.prepare(`SELECT COUNT(*) as count FROM photos`).get();

    const failedCount = totemId
      ? db.prepare(`SELECT COUNT(*) as count FROM transactions WHERE status = 'failed' AND totem_id = ?`).get(totemId)
      : db.prepare(`SELECT COUNT(*) as count FROM transactions WHERE status = 'failed'`).get();

    const testCount = totemId
      ? db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(total_value),0) as revenue FROM transactions WHERE is_test = 1 AND totem_id = ?`).get(totemId)
      : db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(total_value),0) as revenue FROM transactions WHERE is_test = 1`).get();

    const recentCodes = totemId
      ? db.prepare(`SELECT * FROM codes WHERE totem_id = ? ORDER BY created_at DESC LIMIT 20`).all(totemId)
      : db.prepare(`SELECT * FROM codes ORDER BY created_at DESC LIMIT 20`).all();

    return { totalSales, todaySales, activeCodes, totalPhotos, failedCount, testCount, recentCodes };
  },

  // ---- Config (global e por totem) ----
  getConfig(key, totemId = null) {
    const fullKey = totemId ? `totem_${totemId}_${key}` : key;
    const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get(fullKey);
    return row ? row.value : null;
  },

  setConfig(key, value, totemId = null) {
    const fullKey = totemId ? `totem_${totemId}_${key}` : key;
    db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`).run(fullKey, value);
  },

  getAllPrices(totemId = null) {
    const defaults = { '10x15': { base: '5.00', bulk: '5.00', threshold: '5' }, '15x20': { base: '10.00', bulk: '10.00', threshold: '5' } };
    // Descobrir userId do totem para verificar config de usuario
    let userId = null;
    if (totemId) {
      const t = db.prepare(`SELECT user_id FROM totems WHERE id = ?`).get(totemId);
      if (t) userId = t.user_id;
    }
    const getCfg = (key, tid) => {
      // 1) Totem-specific
      if (tid) {
        const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get(`totem_${tid}_${key}`);
        if (row && row.value !== null && row.value !== '') return row.value;
      }
      // 2) User-level
      if (userId) {
        const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get(`user_${userId}_${key}`);
        if (row && row.value !== null && row.value !== '') return row.value;
      }
      // 3) Global fallback
      const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get(key);
      if (row && row.value !== null && row.value !== '') return row.value;
      return null;
    };
    const getVal = (baseKey, suffix, tid, fallback) => {
      const key = suffix ? baseKey + '_' + suffix : baseKey;
      return getCfg(key, tid) || fallback;
    };
    const p10 = defaults['10x15'];
    const p20 = defaults['15x20'];
    return {
      preco_10x15: getVal('preco_10x15', null, totemId, p10.base),
      preco_10x15_bulk: getVal('preco_10x15', 'bulk', totemId, p10.bulk),
      preco_10x15_threshold: getVal('preco_10x15', 'threshold', totemId, p10.threshold),
      preco_15x20: getVal('preco_15x20', null, totemId, p20.base),
      preco_15x20_bulk: getVal('preco_15x20', 'bulk', totemId, p20.bulk),
      preco_15x20_threshold: getVal('preco_15x20', 'threshold', totemId, p20.threshold),
    };
  },

  // ---- Password ----
  hashPassword: _hashPassword,
  verifyPassword: _verifyPassword,

  // ---- Usuarios ----
  createUser(name, email, password, plan = 'basic') {
    const hash = _hashPassword(password);
    const result = db.prepare(`INSERT INTO users (name, email, password_hash, plan) VALUES (?, ?, ?, ?)`).run(name, email, hash, plan);
    return result.lastInsertRowid;
  },

  getUserByEmail(email) {
    return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  },

  getUserById(id) {
    return db.prepare(`SELECT id, name, email, plan, created_at, active FROM users WHERE id = ?`).get(id);
  },

  getUsers() {
    return db.prepare(`SELECT id, name, email, plan, created_at, active FROM users ORDER BY name`).all();
  },

  updateUser(id, fields) {
    const ALLOWED = new Set(['name', 'email', 'password_hash', 'plan', 'active']);
    for (const [key, value] of Object.entries(fields)) {
      if (!ALLOWED.has(key)) continue;
      db.prepare(`UPDATE users SET ${key} = ? WHERE id = ?`).run(value, id);
    }
  },

  deleteUser(id) {
    db.prepare(`DELETE FROM licenses WHERE user_id = ?`).run(id);
    db.prepare(`UPDATE totems SET user_id = NULL WHERE user_id = ?`).run(id);
    db.prepare(`DELETE FROM coupons WHERE user_id = ?`).run(id);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  },

  // ---- Licenses ----
  createLicense(userId, totemId = null) {
    const buf = crypto.randomBytes(6);
    const token = 'LIC-' + buf.toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
    db.prepare(`INSERT INTO licenses (user_id, token, totem_id, expires_at) VALUES (?, ?, ?, datetime('now', '+1 year'))`).run(userId, token, totemId || null);
    return token;
  },

  getLicensesByUser(userId) {
    return db.prepare(`SELECT * FROM licenses WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
  },

  getLicenseByToken(token) {
    return db.prepare(`SELECT l.*, u.name as user_name FROM licenses l JOIN users u ON u.id = l.user_id WHERE l.token = ?`).get(token);
  },

  getAllLicenses() {
    return db.prepare(`SELECT l.*, u.name as user_name FROM licenses l JOIN users u ON u.id = l.user_id ORDER BY l.created_at DESC`).all();
  },

  updateLicense(id, fields) {
    const ALLOWED = new Set(['user_id', 'token', 'totem_id', 'expires_at', 'active']);
    for (const [key, value] of Object.entries(fields)) {
      if (!ALLOWED.has(key)) continue;
      db.prepare(`UPDATE licenses SET ${key} = ? WHERE id = ?`).run(value, id);
    }
  },

  deleteLicense(id) {
    db.prepare(`DELETE FROM licenses WHERE id = ?`).run(id);
  },

  unbindTotem(totemId) {
    db.prepare(`UPDATE totems SET user_id = NULL WHERE id = ?`).run(totemId);
  },

  bindLicenseToTotem(token, totemId) {
    db.prepare(`UPDATE licenses SET totem_id = ? WHERE token = ? AND totem_id IS NULL`).run(totemId, token);
  },

  getLicenseByTotemId(totemId) {
    return db.prepare(`SELECT * FROM licenses WHERE totem_id = ? LIMIT 1`).get(totemId);
  },

  // ---- Vincular totem a um usuario ----
  bindTotemToUser(totemId, userId) {
    db.prepare(`UPDATE totems SET user_id = ? WHERE id = ?`).run(userId, totemId);
  },

  getTotemsByUser(userId) {
    return db.prepare(`SELECT * FROM totems WHERE user_id = ? ORDER BY name`).all(userId);
  },

  // ---- Telemetry ----
  saveTelemetry(totemId, { cpu, ram, paper_10x15, paper_15x20, printer_error, printer_name }) {
    db.prepare(`INSERT INTO telemetry (totem_id, cpu, ram, paper_10x15, paper_15x20, printer_error, printer_name) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(totemId, cpu || '0', ram || '0', paper_10x15 || '0', paper_15x20 || '0', printer_error || '', printer_name || '');
  },

  saveScreenshot(totemId, screenshotBase64) {
    db.prepare(`INSERT OR REPLACE INTO screenshots (totem_id, screenshot, updated_at) VALUES (?, ?, datetime('now'))`)
      .run(totemId, screenshotBase64);
  },

  getLatestTelemetry(totemId) {
    return db.prepare(`SELECT * FROM telemetry WHERE totem_id = ? ORDER BY created_at DESC LIMIT 1`).get(totemId) || null;
  },

  getLatestScreenshot(totemId) {
    return db.prepare(`SELECT screenshot, updated_at FROM screenshots WHERE totem_id = ?`).get(totemId) || null;
  },

  getTelemetryHistory(totemId, limit = 60) {
    return db.prepare(`SELECT * FROM telemetry WHERE totem_id = ? ORDER BY created_at ASC LIMIT ?`).all(totemId, limit);
  },

  getLatestTelemetryForTotems(totemIds) {
    if (!totemIds || totemIds.length === 0) return {};
    const placeholders = totemIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT t.* FROM telemetry t INNER JOIN (SELECT totem_id, MAX(created_at) as max_time FROM telemetry WHERE totem_id IN (${placeholders}) GROUP BY totem_id) latest ON t.totem_id = latest.totem_id AND t.created_at = latest.max_time`).all(...totemIds);
    const result = {};
    for (const row of rows) result[row.totem_id] = row;
    // Preencher com null para totems sem telemetria
    for (const id of totemIds) { if (!result[id]) result[id] = { totem_id: id, cpu: '0', ram: '0', paper_10x15: '0', paper_15x20: '0', printer_error: '', printer_name: '', created_at: null }; }
    return result;
  },

  cleanupTelemetry() {
    // Keep only last 50 records per totem, delete older
    const totems = db.prepare(`SELECT DISTINCT totem_id FROM telemetry`).all();
    for (const t of totems) {
      db.prepare(`DELETE FROM telemetry WHERE id NOT IN (SELECT id FROM telemetry WHERE totem_id = ? ORDER BY created_at DESC LIMIT 50) AND totem_id = ?`).run(t.totem_id, t.totem_id);
    }
    // Delete screenshots with no recent telemetry (older than 24h)
    db.prepare(`DELETE FROM screenshots WHERE updated_at < datetime('now', '-1 day')`).run();
  },

  // ---- Coupons ----
  createCoupon(userId, { code, description, discountType, discountValue, quantity, sizeAllowed, expiresAt, maxUses, maxUsesPerCpf, totemIds }) {
    const result = db.prepare(`
      INSERT INTO coupons (user_id, code, description, discount_type, discount_value, quantity, size_allowed, expires_at, max_uses, max_uses_per_cpf)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, code.toUpperCase(), description || '', discountType || 'free_photo', discountValue || 100, quantity || 1, sizeAllowed || 'both', expiresAt || null, maxUses || null, maxUsesPerCpf || 1);
    const couponId = result.lastInsertRowid;
    if (totemIds && totemIds.length > 0) {
      const stmt = db.prepare(`INSERT INTO coupon_totems (coupon_id, totem_id) VALUES (?, ?)`);
      for (const tid of totemIds) stmt.run(couponId, tid);
    }
    return couponId;
  },

  getCouponsByUser(userId) {
    return db.prepare(`SELECT * FROM coupons WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
  },

  getCouponByCode(code) {
    return db.prepare(`SELECT * FROM coupons WHERE code = ?`).get(code.toUpperCase());
  },

  getCouponTotemIds(couponId) {
    return db.prepare(`SELECT totem_id FROM coupon_totems WHERE coupon_id = ?`).all(couponId).map(r => r.totem_id);
  },

  getCouponUsageCount(couponId) {
    const r = db.prepare(`SELECT COUNT(*) as count FROM coupon_usages WHERE coupon_id = ?`).get(couponId);
    return r ? r.count : 0;
  },

  getCouponUsageCountByCpf(couponId, cpf) {
    const r = db.prepare(`SELECT COUNT(*) as count FROM coupon_usages WHERE coupon_id = ? AND cpf = ?`).get(couponId, cpf);
    return r ? r.count : 0;
  },

  useCoupon(couponId, cpf, totemId, transactionId, photoSize) {
    db.prepare(`INSERT INTO coupon_usages (coupon_id, cpf, totem_id, transaction_id, photo_size) VALUES (?, ?, ?, ?, ?)`).run(couponId, cpf, totemId, transactionId, photoSize);
  },

  toggleCouponActive(couponId) {
    const c = db.prepare(`SELECT active FROM coupons WHERE id = ?`).get(couponId);
    if (c) db.prepare(`UPDATE coupons SET active = ? WHERE id = ?`).run(c.active ? 0 : 1, couponId);
  },

  getCouponStats(couponId) {
    const coupon = db.prepare(`SELECT * FROM coupons WHERE id = ?`).get(couponId);
    if (!coupon) return null;
    const totalUses = db.prepare(`SELECT COUNT(*) as count FROM coupon_usages WHERE coupon_id = ?`).get(couponId);
    return { ...coupon, totalUses: totalUses?.count || 0 };
  },

  // ---- Notifications ----
  saveNotification(totemId, alertType, alertValue) {
    db.prepare(`INSERT INTO notification_log (totem_id, alert_type, alert_value) VALUES (?, ?, ?)`).run(totemId, alertType, alertValue || '');
  },

  getLastNotification(totemId, alertType) {
    return db.prepare(`SELECT * FROM notification_log WHERE totem_id = ? AND alert_type = ? ORDER BY sent_at DESC LIMIT 1`).get(totemId, alertType) || null;
  },

  getNotificationsByTotem(totemId, limit = 20) {
    return db.prepare(`SELECT * FROM notification_log WHERE totem_id = ? ORDER BY sent_at DESC LIMIT ?`).all(totemId, limit);
  },

  // ---- Client Config ----
  getClientConfig(userId) {
    const rows = db.prepare(`SELECT key, value FROM config WHERE key LIKE ?`).all(`user_${userId}_%`);
    const config = {};
    for (const row of rows) {
      const k = row.key.replace(`user_${userId}_`, '');
      config[k] = row.value;
    }
    return config;
  },

  setClientConfig(prefix, key, value) {
    db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`).run(`${prefix}_${key}`, String(value));
  }
};
