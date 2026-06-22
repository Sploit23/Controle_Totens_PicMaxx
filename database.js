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
      code_id TEXT NOT NULL,
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
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let id = '';
    for (let i = 0; i < 6; i++) id += letters[Math.floor(Math.random() * letters.length)];
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

  // ---- Transacoes ----
  createTransaction(codeId, totalValue, items, totemId) {
    const result = db.prepare(`INSERT INTO transactions (code_id, totem_id, total_value, items) VALUES (?, ?, ?, ?)`).run(codeId, totemId || null, totalValue, JSON.stringify(items || []));
    return result.lastInsertRowid;
  },

  // ---- Finalizar codigo (apos impressao): deletar fotos do disco e BD ----
  finalizeCode(codeId) {
    const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
    const photos = this.getPhotosByCode(codeId);
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

    const totalSales = totemId
      ? db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(total_value),0) as revenue FROM transactions WHERE totem_id = ?`).get(totemId)
      : db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(total_value),0) as revenue FROM transactions`).get();

    const todaySales = totemId
      ? db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(total_value),0) as revenue FROM transactions WHERE totem_id = ? AND date(created_at) = date('now')`).get(totemId)
      : db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(total_value),0) as revenue FROM transactions WHERE date(created_at) = date('now')`).get();

    const activeCodes = totemId
      ? db.prepare(`SELECT COUNT(*) as count FROM codes WHERE used = 0 AND expires_at > datetime('now') AND totem_id = ?`).get(totemId)
      : db.prepare(`SELECT COUNT(*) as count FROM codes WHERE used = 0 AND expires_at > datetime('now')`).get();

    const totalPhotos = totemId
      ? db.prepare(`SELECT COUNT(*) as count FROM photos WHERE code_id IN (SELECT id FROM codes WHERE totem_id = ?)`).get(totemId)
      : db.prepare(`SELECT COUNT(*) as count FROM photos`).get();

    const recentCodes = totemId
      ? db.prepare(`SELECT * FROM codes WHERE totem_id = ? ORDER BY created_at DESC LIMIT 20`).all(totemId)
      : db.prepare(`SELECT * FROM codes ORDER BY created_at DESC LIMIT 20`).all();

    return { totalSales, todaySales, activeCodes, totalPhotos, recentCodes };
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
    const getCfg = (key, tid) => {
      const fullKey = tid ? `totem_${tid}_${key}` : key;
      const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get(fullKey);
      return row ? row.value : null;
    };
    if (totemId) {
      return {
        preco_10x15: getCfg('preco_10x15', totemId) || getCfg('preco_10x15') || '5.00',
        preco_15x20: getCfg('preco_15x20', totemId) || getCfg('preco_15x20') || '10.00',
      };
    }
    return {
      preco_10x15: getCfg('preco_10x15') || '5.00',
      preco_15x20: getCfg('preco_15x20') || '10.00',
    };
  },

  // ---- Cleanup ----
  cleanupExpired() {
    const expired = db.prepare(`SELECT id FROM codes WHERE expires_at < datetime('now') AND used = 0`).all();
    const delPhotos = db.prepare(`DELETE FROM photos WHERE code_id = ?`);
    const delCode = db.prepare(`DELETE FROM codes WHERE id = ?`);
    for (const c of expired) { delPhotos.run(c.id); delCode.run(c.id); }
    return expired.length;
  }
};
