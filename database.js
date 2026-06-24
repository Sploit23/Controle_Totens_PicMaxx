const path = require('path');
const fs = require('fs');
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
  `);

  // Migrations: add colunas novas (ignora se ja existem)
  try { db.exec(`ALTER TABLE transactions ADD COLUMN local_id TEXT`); } catch {}
  try { db.exec(`ALTER TABLE transactions ADD COLUMN is_test INTEGER DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE transactions ADD COLUMN error_reason TEXT`); } catch {}

  return db;
}

const db = initDatabase();

module.exports = {
  db,

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

  // ---- Codigos ----
  createCode(totemId) {
    const digits = '0123456789';
    let id = '';
    for (let i = 0; i < 6; i++) id += digits[Math.floor(Math.random() * digits.length)];
    const expiresMin = parseInt(process.env.CODE_EXPIRE_MINUTES || '60');
    if (totemId) {
      db.prepare(`INSERT OR IGNORE INTO totems (id, name) VALUES (?, ?)`).run(totemId, totemId);
    }
    const stmt = db.prepare(`INSERT INTO codes (id, totem_id, expires_at) VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))`);
    stmt.run(id, totemId || null, expiresMin);
    return id;
  },

  getCode(id) {
    return db.prepare(`SELECT * FROM codes WHERE id = ?`).get(id);
  },

  addPhoto(codeId, filename, originalName, size) {
    db.prepare(`INSERT INTO photos (code_id, filename, original_name, size) VALUES (?, ?, ?, ?)`).run(codeId, filename, originalName, size);
    db.prepare(`UPDATE codes SET photos = photos + 1 WHERE id = ?`).run(codeId);
  },

  getPhotosByCode(codeId) {
    return db.prepare(`SELECT * FROM photos WHERE code_id = ?`).all(codeId);
  },

  useCode(id) {
    db.prepare(`UPDATE codes SET used = 1, used_at = datetime('now') WHERE id = ?`).run(id);
  },

  updateCodeTotemId(codeId, totemId) {
    db.prepare(`UPDATE codes SET totem_id = ? WHERE id = ? AND totem_id IS NULL`).run(totemId, codeId);
  },

  // ---- Transacoes ----
  createTransaction(codeId, totalValue, items, totemId, paymentMethod, localId = null, isTest = 0) {
    const result = db.prepare(`INSERT INTO transactions (code_id, totem_id, total_value, items, payment_method, local_id, is_test) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(codeId, totemId || null, totalValue, JSON.stringify(items || []), paymentMethod || 'unknown', localId, isTest ? 1 : 0);
    return result.lastInsertRowid;
  },

  createFailedTransaction(codeId, totalValue, items, totemId, paymentMethod, errorReason, localId = null, isTest = 0) {
    const safeCodeId = codeId || (() => { const c = 'FAILED_' + Date.now(); try { db.prepare(`INSERT OR IGNORE INTO codes (id) VALUES (?)`).run(c); } catch {} return c; })();
    const result = db.prepare(`INSERT INTO transactions (code_id, totem_id, total_value, items, payment_method, status, error_reason, local_id, is_test) VALUES (?, ?, ?, ?, ?, 'failed', ?, ?, ?)`).run(safeCodeId, totemId || null, totalValue || 0, JSON.stringify(items || []), paymentMethod || 'unknown', errorReason || '', localId, isTest ? 1 : 0);
    return result.lastInsertRowid;
  },

  // ---- Finalizar codigo (apos impressao): deletar fotos do disco e BD ----
  finalizeCode(codeId) {
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
    const photos = db.prepare(`SELECT * FROM photos WHERE code_id = ?`).all(codeId);
    for (const p of photos) {
      const filePath = path.join(uploadDir, p.filename);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    }
    db.prepare(`DELETE FROM photos WHERE code_id = ?`).run(codeId);
    db.prepare(`UPDATE codes SET used = 1, used_at = datetime('now') WHERE id = ?`).run(codeId);
    return photos.length;
  },

  getTransactions(limit = 50, totemId = null) {
    if (totemId) return db.prepare(`SELECT * FROM transactions WHERE totem_id = ? ORDER BY created_at DESC LIMIT ?`).all(totemId, limit);
    return db.prepare(`SELECT * FROM transactions ORDER BY created_at DESC LIMIT ?`).all(limit);
  },

  // ---- Stats ----
  getStats(totemId = null) {
    const params = totemId ? [totemId] : [];

    // Transacoes completadas (exclui teste do revenue)
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
    const getCfg = (key, tid) => {
      const fullKey = tid ? `totem_${tid}_${key}` : key;
      const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get(fullKey);
      if (row && row.value !== null && row.value !== '') return row.value;
      return null;
    };
    const getVal = (baseKey, suffix, tid, fallback) => {
      const key = suffix ? baseKey + '_' + suffix : baseKey;
      return getCfg(key, tid) || getCfg(key) || fallback;
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

  // ---- Cleanup ----
  cleanupExpired() {
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
    const expired = db.prepare(`SELECT id, filename FROM photos WHERE code_id IN (SELECT id FROM codes WHERE expires_at < datetime('now') AND used = 0)`).all();
    for (const p of expired) {
      try { const fp = path.join(uploadDir, p.filename); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch {}
    }
    const delPhotos = db.prepare(`DELETE FROM photos WHERE code_id IN (SELECT id FROM codes WHERE expires_at < datetime('now') AND used = 0)`);
    const delCode = db.prepare(`DELETE FROM codes WHERE expires_at < datetime('now') AND used = 0`);
    delPhotos.run(); delCode.run();
    return expired.length;
  }
};
