require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const totemRoute = require('./routes/totem');
const adminRoute = require('./routes/admin');
const clientRoute = require('./routes/client');
const { createUser, getUserByEmail, getDB } = require('./database');
const { initWebSocket } = require('./ws-manager');

const PORT = process.env.PORT || 3000;
const app = express();

function log(rid, msg, data) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = rid ? `[${ts}][${rid}]` : `[${ts}]`;
  if (data) console.log(`${prefix} ${msg}`, data);
  else console.log(`${prefix} ${msg}`);
}

app.use((req, res, next) => {
  req.rid = crypto.randomBytes(4).toString('hex');
  res.on('finish', () => {
    log(req.rid, `${req.method} ${req.originalUrl} → ${res.statusCode}`);
  });
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api/totem', totemRoute);
app.use('/admin', adminRoute);
app.use('/client', clientRoute);

app.get('/', (req, res) => res.redirect('/admin'));

// ─── Seed: criar usuario Flavio + licenca de teste ───
function seedInitialUser() {
  const db = getDB();
  const { createLicense } = require('./database');
  const TEST_LICENSE = 'LIC-A1B2-C3D4-E5F6';

  let userId;
  const existing = getUserByEmail('flavio@reveleagora.com.br');
  if (existing) {
    userId = existing.id;
    // Vincular totens sem user_id ao Flavio
    db.prepare(`UPDATE totems SET user_id = ? WHERE user_id IS NULL`).run(userId);
  } else {
    userId = createUser('Flavio', 'flavio@reveleagora.com.br', 'HCss221087', 'pro');
    log(null, `Usuario Flavio criado (id=${userId})`);
    // Vincular totens existentes
    db.prepare(`UPDATE totems SET user_id = ? WHERE user_id IS NULL`).run(userId);
  }

  // Garantir que a licenca de teste existe (INSERT OR IGNORE)
  db.prepare(`
    INSERT OR IGNORE INTO licenses (token, user_id, totem_id, expires_at, active)
    VALUES (?, ?, NULL, datetime('now', '+1 year'), 1)
  `).run(TEST_LICENSE, userId);

  log(null, `Licenca de teste: ${TEST_LICENSE} (usuario ${userId})`);

  // Criar licencas para totens vinculados (se ainda nao existirem)
  const totems = db.prepare(`SELECT id FROM totems WHERE user_id = ?`).all(userId);
  for (const t of totems) {
    const existingLic = db.prepare(`SELECT id FROM licenses WHERE totem_id = ?`).get(t.id);
    if (!existingLic) {
      const token = createLicense(userId, t.id);
      log(null, `Licenca criada: ${token} para totem ${t.id}`);
    }
  }

  if (totems.length > 0) log(null, `Seed — ${totems.length} totem(s) vinculado(s) ao Flavio`);
}

seedInitialUser();

const server = http.createServer(app);
initWebSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Controle Maxx] Rodando em http://0.0.0.0:${PORT}`);
  console.log(`[Controle Maxx] Admin: http://localhost:${PORT}/admin`);
  console.log(`[Controle Maxx] Client: http://localhost:${PORT}/client`);
  console.log(`[Controle Maxx] WebSocket ready`);
});

module.exports = { log };
