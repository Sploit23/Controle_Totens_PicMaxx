const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function createTestDb() {
  const testPath = path.join(__dirname, 'data', 'test-controle.db');
  if (fs.existsSync(testPath)) fs.unlinkSync(testPath);
  const dir = path.dirname(testPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return testPath;
}

function initTestDatabase(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS totems (
      id TEXT PRIMARY KEY, name TEXT, last_seen TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS codes (
      id TEXT PRIMARY KEY, totem_id TEXT, photos INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT DEFAULT (datetime('now', '+60 minutes')),
      used INTEGER DEFAULT 0, used_at TEXT,
      FOREIGN KEY (totem_id) REFERENCES totems(id)
    );
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_id TEXT NOT NULL, filename TEXT NOT NULL,
      original_name TEXT NOT NULL, size INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (code_id) REFERENCES codes(id)
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_id TEXT NOT NULL, totem_id TEXT,
      total_value REAL DEFAULT 0, items TEXT DEFAULT '[]',
      payment_method TEXT DEFAULT 'qr_code', status TEXT DEFAULT 'completed',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (code_id) REFERENCES codes(id),
      FOREIGN KEY (totem_id) REFERENCES totems(id)
    );
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY, value TEXT
    );
  `);
  return db;
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

// ─── Run tests ────────────────────────────────────────
const dbPath = createTestDb();
const db = initTestDatabase(dbPath);
const uploadDir = path.join(__dirname, 'data', 'test-uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

console.log('\n--- Database Tests ---\n');

// Totem registration
test('register totem', () => {
  db.prepare(`INSERT OR IGNORE INTO totems (id, name) VALUES (?, ?)`).run('TEST-TOTEM-1', 'Totem Teste');
  db.prepare(`UPDATE totems SET last_seen = datetime('now') WHERE id = ?`).run('TEST-TOTEM-1');
  const t = db.prepare(`SELECT * FROM totems WHERE id = ?`).get('TEST-TOTEM-1');
  assert(t && t.name === 'Totem Teste', 'totem should exist with correct name');
});

test('create 6-letter code', () => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let id = '';
  for (let i = 0; i < 6; i++) id += letters[Math.floor(Math.random() * letters.length)];
  assert(id.length === 6, 'code should be 6 chars');
  assert(/^[A-Z]{6}$/.test(id), 'code should be uppercase letters only');
  db.prepare(`INSERT INTO codes (id, totem_id) VALUES (?, ?)`).run(id, 'TEST-TOTEM-1');
  const c = db.prepare(`SELECT * FROM codes WHERE id = ?`).get(id);
  assert(c && c.id === id, 'code should be retrievable');
  assert(c.used === 0, 'new code should not be used');
});

test('prevent duplicate code', () => {
  const id = 'ABCDEF';
  db.prepare(`INSERT OR IGNORE INTO codes (id) VALUES (?)`).run(id);
  const result = db.prepare(`INSERT OR IGNORE INTO codes (id) VALUES (?)`).run(id);
  assert(result.changes === 0, 'duplicate should be rejected');
});

test('add photos to code', () => {
  const codeId = 'TEST-CODE';
  db.prepare(`INSERT OR IGNORE INTO codes (id) VALUES (?)`).run(codeId);
  db.prepare(`INSERT INTO photos (code_id, filename, original_name, size) VALUES (?, ?, ?, ?)`).run(codeId, 'foto1.jpg', 'minha_foto.jpg', 1024);
  db.prepare(`INSERT INTO photos (code_id, filename, original_name, size) VALUES (?, ?, ?, ?)`).run(codeId, 'foto2.jpg', 'selfie.jpg', 2048);
  db.prepare(`UPDATE codes SET photos = photos + 2 WHERE id = ?`).run(codeId);
  const photos = db.prepare(`SELECT * FROM photos WHERE code_id = ?`).all(codeId);
  assert(photos.length === 2, 'should have 2 photos');
  assert(photos[0].original_name === 'minha_foto.jpg', 'original name preserved');
  const code = db.prepare(`SELECT * FROM codes WHERE id = ?`).get(codeId);
  assert(code.photos === 2, 'photo count should match');
});

test('expire code', () => {
  const id = 'EXPIRES';
  db.prepare(`INSERT INTO codes (id, expires_at) VALUES (?, datetime('now', '-1 minute'))`).run(id);
  const code = db.prepare(`SELECT * FROM codes WHERE id = ?`).get(id);
  assert(new Date() > new Date(code.expires_at + 'Z'), 'code should be expired');
});

test('pricing config (global)', () => {
  db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`).run('preco_10x15', '6.00');
  db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`).run('preco_10x15_bulk', '5.00');
  db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`).run('preco_10x15_threshold', '10');
  const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get('preco_10x15');
  assert(row.value === '6.00', 'price should be 6.00');
});

test('pricing config (per-totem overrides global)', () => {
  const totemId = 'OVERRIDE-TEST';
  db.prepare(`INSERT OR IGNORE INTO totems (id) VALUES (?)`).run(totemId);
  db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`).run(`totem_${totemId}_preco_10x15`, '7.50');
  const globalRow = db.prepare(`SELECT value FROM config WHERE key = ?`).get('preco_10x15');
  const totemRow = db.prepare(`SELECT value FROM config WHERE key = ?`).get(`totem_${totemId}_preco_10x15`);
  assert(globalRow.value === '6.00', 'global should still be 6.00');
  assert(totemRow.value === '7.50', 'totem override should be 7.50');
});

test('create transaction', () => {
  const codeId = 'TX-CODE';
  db.prepare(`INSERT OR IGNORE INTO codes (id) VALUES (?)`).run(codeId);
  const items = JSON.stringify([{ type: '10x15', qty: 2 }, { type: '15x20', qty: 1 }]);
  const result = db.prepare(`INSERT INTO transactions (code_id, totem_id, total_value, items, payment_method) VALUES (?, ?, ?, ?, ?)`).run(codeId, 'TEST-TOTEM-1', 20.00, items, 'pix');
  assert(result.lastInsertRowid > 0, 'transaction should have ID');
  const tx = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(result.lastInsertRowid);
  assert(parseFloat(tx.total_value) === 20.00, 'value should be 20.00');
  assert(JSON.parse(tx.items).length === 2, 'should have 2 items');
});

test('finalize code (delete photos)', () => {
  const codeId = 'FINALIZE';
  db.prepare(`INSERT OR IGNORE INTO codes (id) VALUES (?)`).run(codeId);
  db.prepare(`INSERT INTO photos (code_id, filename, original_name) VALUES (?, ?, ?)`).run(codeId, 'del1.jpg', 'delete.jpg');
  const delPhotos = db.prepare(`DELETE FROM photos WHERE code_id = ?`);
  delPhotos.run(codeId);
  db.prepare(`UPDATE codes SET used = 1, used_at = datetime('now') WHERE id = ?`).run(codeId);
  const remaining = db.prepare(`SELECT COUNT(*) as c FROM photos WHERE code_id = ?`).get(codeId);
  assert(remaining.c === 0, 'photos should be deleted');
  const code = db.prepare(`SELECT * FROM codes WHERE id = ?`).get(codeId);
  assert(code.used === 1, 'code should be used');
});

test('transaction stats', () => {
  const stats = db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(total_value),0) as revenue FROM transactions`).get();
  assert(stats.count > 0, 'should have transactions');
  assert(parseFloat(stats.revenue) > 0, 'revenue should be positive');
});

// ─── Cleanup ───────────────────────────────────────────
db.close();
try { fs.unlinkSync(dbPath); } catch {}
try { fs.rmSync(uploadDir, { recursive: true, force: true }); } catch {}

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
