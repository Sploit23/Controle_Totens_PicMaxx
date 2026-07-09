const express = require('express');
const crypto = require('crypto');
const { getUserByEmail, getUserById, getUsers, createUser, updateUser,
        getTotems, getTotem, getTotemsByUser, registerTotem, getTotemConfig,
        getTransactions, getStats,
        getClientConfig, setClientConfig,
        createLicense, getLicensesByUser, getLicenseByToken, getAllLicenses, updateLicense,
        getLicenseByTotemId,
        hashPassword, verifyPassword, updateTotemName,
        getLatestTelemetry, getLatestScreenshot,
        getLatestTelemetryForTotems } = require('../database');
const { notifyTotem, notifyUserTotems } = require('../ws-manager');

const sessions = new Map();

function log(rid, msg, data) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = rid ? `[${ts}][${rid}]` : `[${ts}]`;
  if (data) console.log(`${prefix} ${msg}`, data);
  else console.log(`${prefix} ${msg}`);
}

function auth(req, res, next) {
  const sid = req.cookies?.client_sid;
  if (sid && sessions.has(sid)) {
    req.session = sessions.get(sid);
    return next();
  }
  if (req.path === '/login' || (req.method === 'POST' && req.path === '/login')) return next();
  res.redirect('/client/login');
}

const router = express.Router();
router.use(auth);

// ─── LOGIN ─────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session) return res.redirect('/client');
  res.send(loginPage());
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.send(loginPage('Preencha email e senha'));

  const user = getUserByEmail(email);
  if (!user) return res.send(loginPage('Email ou senha incorretos'));
  if (!user.active) return res.send(loginPage('Conta desativada. Contate o suporte.'));

  if (!verifyPassword(password, user.password_hash)) return res.send(loginPage('Email ou senha incorretos'));

  const sid = crypto.randomBytes(16).toString('hex');
  sessions.set(sid, { userId: user.id, name: user.name, email: user.email });
  res.cookie('client_sid', sid, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
  res.redirect('/client');
});

router.get('/logout', (req, res) => {
  const sid = req.cookies?.client_sid;
  if (sid) sessions.delete(sid);
  res.clearCookie('client_sid');
  res.redirect('/client/login');
});

// ─── DASHBOARD ─────────────────────────────────────────
router.get('/', (req, res) => {
  const user = getUserById(req.session.userId);
  if (!user) { req.session = null; return res.redirect('/client/login'); }

  const page = req.query.page || 'kiosk';
  const selectedTotemId = req.query.totem || '';
  const clientTotems = getTotemsByUser(user.id);
  const licenses = getLicensesByUser(user.id);
  const config = getClientConfig(user.id);

  // Variaveis compartilhadas
  let pageTitle = 'Kiosk', pageContent = '';

  if (page === 'kiosk' && selectedTotemId) {
    const totem = getTotem(selectedTotemId);
    if (!totem || totem.user_id !== user.id) return res.redirect('/client?page=kiosk');
    pageTitle = totem.name || totem.id;
    const reportedConfig = getTotemConfig(selectedTotemId);
    const stats = getStats(selectedTotemId);
    const txs = getTransactions(50, selectedTotemId);
    const license = getLicenseByTotemId(selectedTotemId);
    pageContent = kioskDetailPage(user, totem, license, reportedConfig, config, stats, txs);
  } else if (page === 'licenses') {
    pageTitle = 'Licenças';
    pageContent = licensesPage(user, licenses);
  } else if (page === 'settings') {
    pageTitle = 'Cadastros';
    pageContent = settingsPage(user, config);
  } else if (page === 'monitoring') {
    pageTitle = 'Monitoramento';
    const stats = {};
    const telemetry = {};
    let allTxs = [];
    for (const t of clientTotems) {
      const s = getStats(t.id);
      stats[t.id] = s;
      telemetry[t.id] = getLatestTelemetry(t.id);
      allTxs.push(...getTransactions(100, t.id));
    }
    allTxs.sort((a, b) => b.created_at.localeCompare(a.created_at));
    allTxs.splice(100);
    pageContent = monitoringPage(user, clientTotems, stats, telemetry, allTxs);
  } else if (page === 'live') {
    pageTitle = '📡 Ao Vivo';
    pageContent = livePage(user, clientTotems);
  } else {
    // Kiosk list (default)
    pageContent = kioskListPage(user, clientTotems, config);
  }

  res.send(layoutPage(user, page, pageTitle, pageContent));
});

// ─── API: RENOMEAR TOTEM ──────────────────────────────
router.post('/totem/rename', (req, res) => {
  const user = getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Nao autorizado' });

  const { totemId, name } = req.body;
  if (!totemId || !name) return res.status(400).json({ error: 'totemId e name obrigatorios' });

  const totem = getTotem(totemId);
  if (!totem || totem.user_id !== user.id) return res.status(403).json({ error: 'Totem nao pertence a este usuario' });

  updateTotemName(totemId, name.trim());
  log(req.rid, `Totem ${totemId} renomeado para "${name.trim()}" pelo usuario ${user.id}`);
  res.json({ success: true, name: name.trim() });
});

// ─── API: SALVAR CONFIG ───────────────────────────────
router.post('/config', (req, res) => {
  const user = getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Nao autorizado' });

  const totemId = req.query.totem || null;

  // Se for por totem, verificar se o totem pertence ao usuario
  if (totemId) {
    const totem = getTotem(totemId);
    if (!totem || totem.user_id !== user.id) return res.status(403).json({ error: 'Totem nao pertence a este usuario' });
  }

  const allowed = ['stone_code', 'mp_public_key', 'mp_access_token',
    'preco_10x15', 'preco_10x15_bulk', 'preco_10x15_threshold',
    'preco_15x20', 'preco_15x20_bulk', 'preco_15x20_threshold',
    'combo_enabled', 'sizes_enabled'];

  const targetKey = totemId ? `totem_${totemId}` : `user_${user.id}`;

  for (const [key, value] of Object.entries(req.body)) {
    if (allowed.includes(key)) {
      // Salva como user_{id}_{key} ou totem_{totemId}_{key}
      setClientConfig(targetKey, key, value);
    }
  }
  log(req.rid, `Config salva: ${targetKey}`);

  // Notificar kiosk(s) via WebSocket para atualizar precos/config
  if (totemId) {
    notifyTotem(totemId, { type: 'reloadConfig' });
    log(req.rid, `WebSocket: notificando totem ${totemId}`);
  } else {
    const count = notifyUserTotems(user.id, { type: 'reloadConfig' });
    if (count > 0) log(req.rid, `WebSocket: notificando ${count} totem(s) do usuario ${user.id}`);
  }

  res.json({ success: true });
});

// ─── API: DADOS DO CLIENTE (para kiosk) ───────────────
router.get('/api/config', (req, res) => {
  const user = getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Nao autorizado' });

  const config = getClientConfig(user.id);
  const prices = {
    preco_10x15: config.preco_10x15 || '5.00',
    preco_10x15_bulk: config.preco_10x15_bulk || '5.00',
    preco_10x15_threshold: config.preco_10x15_threshold || '5',
    preco_15x20: config.preco_15x20 || '10.00',
    preco_15x20_bulk: config.preco_15x20_bulk || '10.00',
    preco_15x20_threshold: config.preco_15x20_threshold || '5',
    combo_enabled: config.combo_enabled || '1',
  };
  const licenses = getLicensesByUser(user.id);

  res.json({
    success: true,
    stoneCode: config.stone_code || '',
    mercadopago: {
      publicKey: config.mp_public_key || '',
      accessToken: config.mp_access_token ? '***' : '',
    },
    prices,
    totems: getTotems().filter(t => t.user_id === user.id).map(t => ({ id: t.id, name: t.name, lastSeen: t.last_seen })),
    licenses: licenses.map(l => ({ token: l.token, totemId: l.totem_id, expiresAt: l.expires_at, active: l.active })),
  });
});

module.exports = router;

// ══════════════════════════════════════════════════════════
//  PAGES HTML
// ══════════════════════════════════════════════════════════

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function loginPage(error) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Minha Conta — Revele Agora</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Inter',sans-serif; background:#f5f5f5; display:flex; align-items:center; justify-content:center; min-height:100vh; }
.login-card { background:#fff; border-radius:24px; padding:48px 40px; width:100%; max-width:420px; box-shadow:0 10px 40px rgba(0,0,0,.08); text-align:center; }
.logo { width:80px; height:80px; background:#d8232a; border-radius:20px; display:flex; align-items:center; justify-content:center; margin:0 auto 24px; font-size:36px; color:#fff; font-weight:900; }
h1 { font-size:24px; font-weight:700; margin-bottom:8px; }
.sub { color:#666; font-size:14px; margin-bottom:32px; }
.error { background:#fff0f0; color:#d8232a; padding:12px 16px; border-radius:12px; font-size:14px; margin-bottom:20px; border:1px solid #ffd5d5; }
label { display:block; text-align:left; font-size:13px; font-weight:600; color:#333; margin-bottom:6px; }
input { width:100%; padding:14px 16px; border:2px solid #e0e0e0; border-radius:12px; font-size:15px; outline:none; transition:.2s; margin-bottom:20px; }
input:focus { border-color:#d8232a; }
button { width:100%; padding:14px; background:#d8232a; color:#fff; font-size:16px; font-weight:700; border:none; border-radius:12px; cursor:pointer; transition:.2s; }
button:hover { background:#b81d23; }
</style>
</head>
<body>
<div class="login-card">
  <div class="logo">R</div>
  <h1>Minha Conta</h1>
  <p class="sub">Acesse seu painel de controle</p>
  ${error ? `<div class="error">${error}</div>` : ''}
  <form method="post">
    <label for="email">Email</label>
    <input type="email" id="email" name="email" placeholder="seu@email.com" required autofocus>
    <label for="password">Senha</label>
    <input type="password" id="password" name="password" placeholder="••••••••" required>
    <button type="submit">Entrar</button>
  </form>
</div>
</body>
</html>`;
}

// ══════════════════════════════════════════════════════════
//  PAGE FUNCTIONS (tabbed navigation)
// ══════════════════════════════════════════════════════════

function fmt(v) { return parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 }); }
function fmtMoney(v) { return `R$ ${fmt(v)}`; }

// ─── LAYOUT with nav tabs ───────────────────────────────
function layoutPage(user, activePage, pageTitle, pageContent) {
  const tabs = [
    { id: 'kiosk',       label: 'Kiosk' },
    { id: 'licenses',    label: 'Licenças' },
    { id: 'settings',    label: 'Cadastros' },
    { id: 'monitoring',  label: 'Monitoramento' },
    { id: 'live',        label: '📡 Ao Vivo' },
  ];

  const navTabs = tabs.map(t =>
    `<a href="/client?page=${t.id}" class="nav-tab${activePage === t.id ? ' active' : ''}">${t.label}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle} — ${user.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter',sans-serif;background:#f5f5f5;color:#1a1a1a;}
.header{background:#fff;border-bottom:1px solid #e5e5e5;padding:16px 32px;display:flex;align-items:center;justify-content:space-between;}
.header-left{display:flex;align-items:center;gap:12px;}
.header-logo{width:36px;height:36px;background:#d8232a;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:16px;}
.header-left h2{font-size:18px;font-weight:700;}
.header-right{display:flex;align-items:center;gap:16px;}
.header-right span{color:#666;font-size:14px;}
.btn-logout{padding:8px 16px;background:transparent;border:1px solid #e0e0e0;border-radius:8px;cursor:pointer;font-size:13px;color:#666;text-decoration:none;transition:.2s;}
.btn-logout:hover{background:#f5f5f5;color:#d8232a;border-color:#d8232a;}
.nav{background:#fff;border-bottom:1px solid #e5e5e5;padding:0 32px;display:flex;gap:0;}
.nav-tab{padding:14px 28px;font-size:14px;font-weight:600;color:#888;text-decoration:none;border-bottom:3px solid transparent;transition:.2s;}
.nav-tab:hover{color:#d8232a;}
.nav-tab.active{color:#d8232a;border-color:#d8232a;}
.container{max-width:1100px;margin:0 auto;padding:24px 32px;}
.page-header{margin-bottom:24px;}
.page-header h1{font-size:22px;font-weight:900;}
.page-header p{color:#666;font-size:14px;margin-top:4px;}
.section{background:#fff;border-radius:16px;padding:24px;margin-bottom:24px;box-shadow:0 2px 8px rgba(0,0,0,.04);}
.section h3{font-size:16px;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{text-align:left;padding:10px 12px;border-bottom:2px solid #f0f0f0;color:#999;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;}
td{padding:10px 12px;border-bottom:1px solid #f5f5f5;}
tr:hover td{background:#fafafa;}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;}
.badge-completed{background:#e8f5e9;color:#16a34a;}
.badge-failed{background:#fff0f0;color:#d8232a;}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.form-group{margin-bottom:4px;}
.form-group.full{grid-column:1/-1;}
.form-group label{display:block;font-size:12px;font-weight:600;color:#555;margin-bottom:4px;}
.form-group input,.form-group select{width:100%;padding:10px 12px;border:2px solid #e0e0e0;border-radius:10px;font-size:14px;outline:none;transition:.2s;}
.form-group input:focus{border-color:#d8232a;}
.form-group .hint{font-size:11px;color:#999;margin-top:2px;}
.toggle-row{display:flex;align-items:center;gap:12px;padding:10px 0;}
.toggle{width:44px;height:24px;background:#ccc;border-radius:12px;position:relative;cursor:pointer;transition:.2s;flex-shrink:0;}
.toggle.active{background:#d8232a;}
.toggle::after{content:'';position:absolute;top:2px;left:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:.2s;}
.toggle.active::after{left:22px;}
.toggle input{display:none;}
.btn-save{padding:12px 32px;background:#d8232a;color:#fff;font-size:15px;font-weight:700;border:none;border-radius:12px;cursor:pointer;transition:.2s;margin-top:8px;}
.btn-save:hover{background:#b81d23;}
.btn-back{padding:8px 16px;background:transparent;border:1px solid #e0e0e0;border-radius:8px;cursor:pointer;font-size:13px;color:#666;text-decoration:none;transition:.2s;display:inline-flex;align-items:center;gap:6px;}
.btn-back:hover{color:#d8232a;border-color:#d8232a;}
.toast{display:none;position:fixed;bottom:32px;right:32px;background:#16a34a;color:#fff;padding:14px 24px;border-radius:12px;font-size:14px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.15);z-index:999;animation:slideUp .3s ease;}
@keyframes slideUp{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}
.alert{background:#fff8e1;color:#b8860b;padding:12px 16px;border-radius:12px;font-size:13px;margin-bottom:16px;border:1px solid #ffe082;}
.totem-card{display:flex;align-items:center;gap:16px;padding:16px;border-radius:12px;background:#fafafa;border:1px solid #eee;cursor:pointer;transition:.2s;}
.totem-card:hover{border-color:#d8232a;box-shadow:0 2px 12px rgba(216,35,42,.08);}
.totem-card .status-dot{width:12px;height:12px;border-radius:50%;flex-shrink:0;}
.totem-card .info{flex:1;}
.totem-card .info strong{font-size:15px;}
.totem-card .info .sub{font-size:12px;color:#888;margin-top:2px;}
@media(max-width:700px){.form-grid{grid-template-columns:1fr;}.container{padding:16px;}.nav{padding:0 16px;overflow-x:auto;}}
${activePage === 'monitoring' ? '.monitoring-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;}.stat-card{background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.04);}.stat-card .label{font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.5px;}.stat-card .value{font-size:22px;font-weight:900;color:#1a1a1a;margin-top:2px;}.tel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px;margin-bottom:24px;}.tel-card{background:#fff;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);border:1px solid #eee;}.tel-header{display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #f0f0f0;}.tel-name{font-size:15px;font-weight:700;flex:1;}.tel-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}.tel-online{font-size:12px;color:#888;}.tel-body{display:grid;grid-template-columns:200px 1fr;gap:16px;}.tel-screenshot{width:200px;height:150px;border-radius:8px;overflow:hidden;background:#f0f0f0;display:flex;align-items:center;justify-content:center;}.tel-screenshot img{width:100%;height:100%;object-fit:cover;}.tel-noimg{font-size:12px;color:#999;text-align:center;padding:8px;}.tel-info{display:flex;flex-direction:column;gap:10px;}.tel-gauges{display:flex;flex-direction:column;gap:6px;}.tel-gauge{display:flex;align-items:center;gap:8px;}.tel-glabel{font-size:12px;font-weight:600;color:#555;min-width:32px;}.tel-bar{flex:1;height:16px;background:#eee;border-radius:8px;overflow:hidden;}.tel-fill{height:100%;border-radius:8px;transition:width .5s,background .3s;min-width:4px;max-width:100%;}.tel-gvalue{font-size:13px;font-weight:700;min-width:44px;text-align:right;color:#333;}.tel-paper{display:flex;gap:16px;font-size:13px;color:#555;flex-wrap:wrap;}.tel-footer{display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:12px;}.tel-err{color:#555;}.tel-time{color:#999;}.tel-card-loading{text-align:center;padding:40px;color:#999;}' : ''}
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <div class="header-logo">R</div>
    <h2>Minha Conta</h2>
  </div>
  <div class="header-right">
    <span>${user.email}</span>
    <a href="/client/logout" class="btn-logout">Sair</a>
  </div>
</div>

<div class="nav">${navTabs}</div>

<div class="container">

<div class="page-header">
  <h1>${pageTitle}</h1>
</div>

${pageContent}

<div style="text-align:center;padding:24px 0;color:#bbb;font-size:12px;">
  Revele Agora &copy; 2026 — Controle Maxx
</div>

</div>

</body>
</html>`;
}

// ─── KIOSK LIST ─────────────────────────────────────────
function kioskListPage(user, clientTotems) {
  const online = t => t.last_seen && (Date.now() - new Date(t.last_seen+'Z').getTime()) < 180000;

  const cards = clientTotems.map((t, i) => {
    const isOnline = online(t);
    return `<a href="/client?page=kiosk&totem=${t.id}" class="totem-card" style="display:flex;text-decoration:none;color:inherit;margin-bottom:8px;">
      <span class="status-dot" style="background:${isOnline?'#22c55e':'#ef4444'}"></span>
      <div class="info">
        <strong>${t.name || t.id}</strong>
        <div class="sub">${isOnline ? 'Online' : 'Offline'} · ${t.last_seen ? 'Visto em ' + new Date(t.last_seen+'Z').toLocaleString('pt-BR') : 'Nunca conectou'}</div>
      </div>
      <span style="font-size:20px;color:#ccc;">›</span>
    </a>`;
  }).join('') || '<div class="alert">Nenhum totem registrado. Quando seu totem conectar, aparecerá aqui.</div>';

  const onlineCount = clientTotems.filter(t => online(t)).length;

  return `
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;">
  <div style="background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.04);">
    <div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.5px;">Totens</div>
    <div style="font-size:22px;font-weight:900;color:#1a1a1a;margin-top:2px;">${clientTotems.length}</div>
    <div style="font-size:11px;color:#999;margin-top:2px;">${onlineCount} online</div>
  </div>
  <div style="background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.04);">
    <div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.5px;">Offline</div>
    <div style="font-size:22px;font-weight:900;color:#1a1a1a;margin-top:2px;">${clientTotems.length - onlineCount}</div>
    <div style="font-size:11px;color:#999;margin-top:2px;">há mais de 3 min</div>
  </div>
</div>

<h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">Seus Totens</h3>
${cards}`;
}

// ─── KIOSK DETAIL ──────────────────────────────────────
function kioskDetailPage(user, totem, license, reportedConfig, config, stats, txs) {
  const online = totem.last_seen && (Date.now() - new Date(totem.last_seen+'Z').getTime()) < 180000;
  const methodLabels = { pix:'PIX', credit:'Crédito', debit:'Débito', test:'Teste', money:'Dinheiro', unknown:'—' };

  const txRows = txs.map(t => {
    const items = JSON.parse(t.items || '[]');
    const itemStr = items.map(i => `${i.qty}x ${i.type}`).join(', ') || '—';
    return `<tr>
      <td>${t.created_at ? new Date(t.created_at+'Z').toLocaleString('pt-BR') : '—'}</td>
      <td>${t.code_id || '—'}</td>
      <td>${itemStr}</td>
      <td>${fmtMoney(t.total_value)}</td>
      <td><span class="badge badge-${t.status}">${t.status === 'completed' ? 'Aprovado' : 'Falha'}</span></td>
      <td>${methodLabels[t.payment_method] || t.payment_method}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:#999;padding:30px;">Nenhuma transacao ainda</td></tr>';

  const comboChecked = config.combo_enabled === '1' ? 'active' : '';

  const reportedBlock = Object.keys(reportedConfig).length > 0 ? `
  <div style="background:#f8f9ff;border:1px solid #dde1ff;border-radius:12px;padding:16px;margin-bottom:20px;">
    <h4 style="font-size:13px;font-weight:700;color:#444;margin-bottom:12px;">📡 Valores atuais do kiosk (lidos do totem)</h4>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px;">
      ${reportedConfig.stoneCode ? `<div><span style="color:#888;">Stone Code:</span> <strong>${reportedConfig.stoneCode}</strong></div>` : ''}
      ${reportedConfig.mpPublicKey ? `<div><span style="color:#888;">MP Public Key:</span> <strong>${reportedConfig.mpPublicKey}</strong></div>` : ''}
      ${reportedConfig.mpAccessToken ? `<div><span style="color:#888;">MP Access Token:</span> <strong style="color:#16a34a;">✓ Configurado</strong></div>` : '<div><span style="color:#888;">MP Access Token:</span> <strong style="color:#ef4444;">Não configurado</strong></div>'}
    </div>
  </div>` : '';

  return `
<a href="/client?page=kiosk" class="btn-back" style="margin-bottom:16px;display:inline-flex;">‹ Voltar</a>

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;">
  <div style="background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.04);">
    <div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.5px;">ID</div>
    <div style="font-size:16px;font-weight:700;color:#1a1a1a;margin-top:2px;">${totem.id}</div>
  </div>
  <div style="background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.04);">
    <div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.5px;">Status</div>
    <div style="display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;color:#1a1a1a;margin-top:2px;">
      <span style="width:10px;height:10px;border-radius:50%;background:${online?'#22c55e':'#ef4444'}"></span>${online?'Online':'Offline'}
    </div>
  </div>
  <div style="background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.04);">
    <div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.5px;">Vendas Hoje</div>
    <div style="font-size:22px;font-weight:900;color:#1a1a1a;margin-top:2px;">${stats.todaySales.count}</div>
    <div style="font-size:11px;color:#999;margin-top:2px;">${fmtMoney(stats.todaySales.revenue)}</div>
  </div>
  <div style="background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.04);">
    <div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.5px;">Total</div>
    <div style="font-size:22px;font-weight:900;color:#1a1a1a;margin-top:2px;">${stats.totalSales.count}</div>
    <div style="font-size:11px;color:#999;margin-top:2px;">${fmtMoney(stats.totalSales.revenue)}</div>
  </div>
</div>

<div class="section">
  <h3>ℹ️ Informações do Totem</h3>
  <div style="display:flex;flex-direction:column;gap:12px;">
    <div style="display:flex;align-items:center;gap:12px;">
      <span style="font-weight:600;font-size:14px;color:#555;min-width:80px;">Nome:</span>
      <span id="detail-name-text">${totem.name || totem.id}</span>
      <input id="detail-name-input" value="${totem.name || totem.id}" style="display:none;padding:6px 10px;border:2px solid #d8232a;border-radius:8px;font-size:14px;outline:none;flex:1;max-width:300px;">
      <button id="detail-rename-btn" onclick="toggleRename()" style="padding:6px 16px;background:transparent;border:1px solid #ccc;border-radius:6px;cursor:pointer;font-size:12px;">Renomear</button>
      <button id="detail-save-btn" onclick="saveDetailName('${totem.id}')" style="display:none;padding:6px 16px;background:#d8232a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Salvar</button>
      <button id="detail-cancel-btn" onclick="cancelDetailRename('${escapeHtml(totem.name || totem.id)}')" style="display:none;padding:6px 16px;background:transparent;border:1px solid #ccc;border-radius:6px;cursor:pointer;font-size:12px;">Cancelar</button>
    </div>
    <div style="display:flex;align-items:center;gap:12px;">
      <span style="font-weight:600;font-size:14px;color:#555;min-width:80px;">Última vez:</span>
      <span>${totem.last_seen ? new Date(totem.last_seen+'Z').toLocaleString('pt-BR') : 'Nunca'}</span>
    </div>
    <div style="display:flex;align-items:center;gap:12px;">
      <span style="font-weight:600;font-size:14px;color:#555;min-width:80px;">Licença:</span>
      <span>${license ? `<code style="background:#f0f0f0;padding:2px 8px;border-radius:4px;font-size:12px;">${license.token}</code> <span style="font-size:12px;color:#888;">(${license.active ? 'Ativa' : 'Inativa'})</span>` : '—'}</span>
    </div>
  </div>
</div>

<div class="section">
  <h3>⚙️ Configurações — ${totem.name || totem.id}</h3>
  <div id="toast" class="toast">Salvo com sucesso!</div>

  ${reportedBlock}

  <form id="configForm" class="form-grid">
    <div class="form-group full" style="border-bottom:1px solid #f0f0f0;padding-bottom:12px;margin-bottom:8px;">
      <h4 style="font-size:14px;font-weight:700;color:#333;">Pagamento</h4>
    </div>
    <div class="form-group">
      <label>Código Stone</label>
      <input type="text" name="stone_code" value="${config.stone_code || ''}" placeholder="Ex: 688912528">
      <div class="hint">Código de identificação Stone</div>
    </div>
    <div class="form-group">
      <label>MP — Public Key</label>
      <input type="text" name="mp_public_key" value="${config.mp_public_key || ''}" placeholder="APP_USR-...">
    </div>
    <div class="form-group full">
      <label>MP — Access Token</label>
      <input type="password" name="mp_access_token" value="${config.mp_access_token || ''}" placeholder="Deixe em branco para manter">
    </div>

    <div class="form-group full" style="border-bottom:1px solid #f0f0f0;padding-bottom:12px;margin:8px 0;">
      <h4 style="font-size:14px;font-weight:700;color:#333;">Preços</h4>
    </div>
    <div class="form-group">
      <label>10×15 — Unitário</label>
      <input type="number" step="0.01" name="preco_10x15" value="${config.preco_10x15 || '5.00'}">
    </div>
    <div class="form-group">
      <label>15×20 — Unitário</label>
      <input type="number" step="0.01" name="preco_15x20" value="${config.preco_15x20 || '10.00'}">
    </div>

    <div class="form-group full" style="border-bottom:1px solid #f0f0f0;padding-bottom:12px;margin:8px 0;">
      <h4 style="font-size:14px;font-weight:700;color:#333;">Combo (Atacado)</h4>
    </div>
    <div class="form-group full">
      <div class="toggle-row">
        <div class="toggle ${comboChecked}" onclick="this.classList.toggle('active');document.getElementById('combo_enabled').value=this.classList.contains('active')?'1':'0'">
          <input type="hidden" id="combo_enabled" name="combo_enabled" value="${config.combo_enabled || '1'}">
        </div>
        <span style="font-size:14px;font-weight:500;">Ativar preço combo</span>
      </div>
      <div class="hint">Mostra "A partir de X unidades" com desconto</div>
    </div>
    <div class="form-group">
      <label>Qtd mínima</label>
      <input type="number" name="preco_10x15_threshold" value="${config.preco_10x15_threshold || '5'}">
    </div>
    <div class="form-group"></div>
    <div class="form-group">
      <label>10×15 — Combo</label>
      <input type="number" step="0.01" name="preco_10x15_bulk" value="${config.preco_10x15_bulk || '5.00'}">
    </div>
    <div class="form-group">
      <label>15×20 — Combo</label>
      <input type="number" step="0.01" name="preco_15x20_bulk" value="${config.preco_15x20_bulk || '10.00'}">
    </div>

    <div class="form-group full" style="border-bottom:1px solid #f0f0f0;padding-bottom:12px;margin:8px 0;">
      <h4 style="font-size:14px;font-weight:700;color:#333;">Tamanhos Disponíveis</h4>
    </div>
    <div class="form-group full">
      <div style="display:flex;gap:12px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:8px;padding:12px 16px;background:#f5f5f5;border-radius:10px;cursor:pointer;flex:1;min-width:120px;">
          <input type="radio" name="sizes_enabled" value="both" ${config.sizes_enabled === '10x15' ? '' : config.sizes_enabled === '15x20' ? '' : 'checked'} onchange="saveSizeInstant(this.value)" style="width:16px;height:16px;accent-color:#d8232a;">
          <span style="font-size:13px;font-weight:600;">10×15 + 15×20</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;padding:12px 16px;background:#f5f5f5;border-radius:10px;cursor:pointer;flex:1;min-width:120px;">
          <input type="radio" name="sizes_enabled" value="10x15" ${config.sizes_enabled === '10x15' ? 'checked' : ''} onchange="saveSizeInstant(this.value)" style="width:16px;height:16px;accent-color:#d8232a;">
          <span style="font-size:13px;font-weight:600;">Só 10×15</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;padding:12px 16px;background:#f5f5f5;border-radius:10px;cursor:pointer;flex:1;min-width:120px;">
          <input type="radio" name="sizes_enabled" value="15x20" ${config.sizes_enabled === '15x20' ? 'checked' : ''} onchange="saveSizeInstant(this.value)" style="width:16px;height:16px;accent-color:#d8232a;">
          <span style="font-size:13px;font-weight:600;">Só 15×20</span>
        </label>
      </div>
    </div>

    <div class="form-group full">
      <button type="submit" class="btn-save">Salvar Configurações</button>
    </div>
  </form>
</div>

<div class="section">
  <h3>📋 Transações Recentes</h3>
  <table>
    <thead><tr><th>Data</th><th>Código</th><th>Itens</th><th>Valor</th><th>Status</th><th>Pagamento</th></tr></thead>
    <tbody>${txRows}</tbody>
  </table>
</div>

<script>
document.getElementById('configForm').onsubmit = async function(e) {
  e.preventDefault();
  const form = new FormData(this);
  const data = {};
  for (const [key, val] of form.entries()) data[key] = val;
  const url = '/client/config?totem=' + encodeURIComponent('${totem.id}');
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const toast = document.getElementById('toast');
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 2500);
};

async function saveSizeInstant(value) {
  await fetch('/client/config?totem=' + encodeURIComponent('${totem.id}'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sizes_enabled: value })
  });
  const toast = document.getElementById('toast');
  toast.textContent = 'Tamanho salvo!';
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 2500);
}

function toggleRename() {
  const text = document.getElementById('detail-name-text');
  const input = document.getElementById('detail-name-input');
  const rb = document.getElementById('detail-rename-btn');
  const sb = document.getElementById('detail-save-btn');
  const cb = document.getElementById('detail-cancel-btn');
  text.style.display = 'none';
  input.style.display = '';
  rb.style.display = 'none';
  sb.style.display = '';
  cb.style.display = '';
  input.focus();
}

function cancelDetailRename(orig) {
  const text = document.getElementById('detail-name-text');
  const input = document.getElementById('detail-name-input');
  const rb = document.getElementById('detail-rename-btn');
  const sb = document.getElementById('detail-save-btn');
  const cb = document.getElementById('detail-cancel-btn');
  text.style.display = '';
  input.style.display = 'none';
  input.value = orig;
  rb.style.display = '';
  sb.style.display = 'none';
  cb.style.display = 'none';
}

async function saveDetailName(totemId) {
  const name = document.getElementById('detail-name-input').value.trim();
  if (!name) return;
  try {
    const res = await fetch('/client/totem/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totemId, name })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('detail-name-text').textContent = data.name;
      cancelDetailRename(data.name);
      document.title = data.name + ' — ' + '${escapeHtml(user.name)}';
    } else alert(data.error || 'Erro ao renomear');
  } catch (e) { alert('Erro de rede'); }
}
</script>`;
}

// ─── LICENSES ──────────────────────────────────────────
function licensesPage(user, licenses) {
  const rows = licenses.map(l =>
    `<tr>
      <td><code style="font-size:13px;background:#f0f0f0;padding:4px 8px;border-radius:6px;">${l.token}</code></td>
      <td>${l.totem_id || '—'}</td>
      <td>${l.expires_at ? new Date(l.expires_at+'Z').toLocaleDateString('pt-BR') : '—'}</td>
      <td><span class="badge badge-${l.active ? 'completed' : 'failed'}">${l.active ? 'Ativa' : 'Inativa'}</span></td>
    </tr>`
  ).join('') || '<tr><td colspan="4" style="text-align:center;color:#999;padding:30px;">Nenhuma licença ainda</td></tr>';

  const total = licenses.length;
  const active = licenses.filter(l => l.active).length;

  return `
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;">
  <div style="background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.04);">
    <div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.5px;">Total</div>
    <div style="font-size:22px;font-weight:900;color:#1a1a1a;margin-top:2px;">${total}</div>
  </div>
  <div style="background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.04);">
    <div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.5px;">Ativas</div>
    <div style="font-size:22px;font-weight:900;color:#16a34a;margin-top:2px;">${active}</div>
  </div>
  <div style="background:#fff;border-radius:12px;padding:16px 20px;box-shadow:0 1px 4px rgba(0,0,0,.04);">
    <div style="font-size:11px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.5px;">Inativas</div>
    <div style="font-size:22px;font-weight:900;color:#ef4444;margin-top:2px;">${total - active}</div>
  </div>
</div>

<div class="section">
  <h3>🔑 Licenças</h3>
  <table>
    <thead><tr><th>Token</th><th>Totem</th><th>Expira</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

// ─── SETTINGS (Cadastros) ──────────────────────────────
function settingsPage(user, config) {
  const comboChecked = config.combo_enabled === '1' ? 'active' : '';

  return `
<div class="section">
  <h3>⚙️ Configurações Gerais</h3>
  <p style="font-size:13px;color:#888;margin-bottom:16px;">Estas configurações valem para todos os totens. Para configurar um totem específico, vá em Kiosk e selecione o totem.</p>

  <div id="toast" class="toast">Salvo com sucesso!</div>

  <form id="settingsForm" class="form-grid">
    <div class="form-group full" style="border-bottom:1px solid #f0f0f0;padding-bottom:12px;margin-bottom:8px;">
      <h4 style="font-size:14px;font-weight:700;color:#333;">Pagamento</h4>
    </div>
    <div class="form-group">
      <label>Código Stone</label>
      <input type="text" name="stone_code" value="${config.stone_code || ''}" placeholder="Ex: 688912528">
    </div>
    <div class="form-group">
      <label>MP — Public Key</label>
      <input type="text" name="mp_public_key" value="${config.mp_public_key || ''}" placeholder="APP_USR-...">
    </div>
    <div class="form-group full">
      <label>MP — Access Token</label>
      <input type="password" name="mp_access_token" value="${config.mp_access_token || ''}" placeholder="Deixe em branco para manter">
    </div>

    <div class="form-group full" style="border-bottom:1px solid #f0f0f0;padding-bottom:12px;margin:8px 0;">
      <h4 style="font-size:14px;font-weight:700;color:#333;">Preços</h4>
    </div>
    <div class="form-group">
      <label>10×15 — Unitário</label>
      <input type="number" step="0.01" name="preco_10x15" value="${config.preco_10x15 || '5.00'}">
    </div>
    <div class="form-group">
      <label>15×20 — Unitário</label>
      <input type="number" step="0.01" name="preco_15x20" value="${config.preco_15x20 || '10.00'}">
    </div>

    <div class="form-group full" style="border-bottom:1px solid #f0f0f0;padding-bottom:12px;margin:8px 0;">
      <h4 style="font-size:14px;font-weight:700;color:#333;">Combo (Atacado)</h4>
    </div>
    <div class="form-group full">
      <div class="toggle-row">
        <div class="toggle ${comboChecked}" onclick="this.classList.toggle('active');document.getElementById('combo_enabled').value=this.classList.contains('active')?'1':'0'">
          <input type="hidden" id="combo_enabled" name="combo_enabled" value="${config.combo_enabled || '1'}">
        </div>
        <span style="font-size:14px;font-weight:500;">Ativar preço combo</span>
      </div>
      <div class="hint">Mostra "A partir de X unidades" com desconto</div>
    </div>
    <div class="form-group">
      <label>Qtd mínima</label>
      <input type="number" name="preco_10x15_threshold" value="${config.preco_10x15_threshold || '5'}">
    </div>
    <div class="form-group"></div>
    <div class="form-group">
      <label>10×15 — Combo</label>
      <input type="number" step="0.01" name="preco_10x15_bulk" value="${config.preco_10x15_bulk || '5.00'}">
    </div>
    <div class="form-group">
      <label>15×20 — Combo</label>
      <input type="number" step="0.01" name="preco_15x20_bulk" value="${config.preco_15x20_bulk || '10.00'}">
    </div>

    <div class="form-group full">
      <button type="submit" class="btn-save">Salvar Configurações</button>
    </div>
  </form>
</div>

<div class="section">
  <h3>👤 Dados da Conta</h3>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:#555;margin-bottom:4px;">Nome</label>
      <div style="font-size:15px;font-weight:600;">${user.name}</div>
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:#555;margin-bottom:4px;">Email</label>
      <div style="font-size:15px;font-weight:600;">${user.email}</div>
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:#555;margin-bottom:4px;">Plano</label>
      <div style="font-size:15px;font-weight:600;text-transform:capitalize;">${user.plan || 'basic'}</div>
    </div>
  </div>
</div>

<script>
document.getElementById('settingsForm').onsubmit = async function(e) {
  e.preventDefault();
  const form = new FormData(this);
  const data = {};
  for (const [key, val] of form.entries()) data[key] = val;
  await fetch('/client/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const toast = document.getElementById('toast');
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 2500);
};
</script>`;
}

// ─── MONITORING ────────────────────────────────────────
function monitoringPage(user, clientTotems, stats, telemetry, allTxs) {
  const methodLabels = { pix:'PIX', credit:'Crédito', debit:'Débito', test:'Teste', money:'Dinheiro', unknown:'—' };

  // Aggregate totals
  let totalRevenue = 0, totalSales = 0, todayRevenue = 0, todaySales = 0;
  for (const [tid, s] of Object.entries(stats)) {
    totalSales += (s.totalSales?.count || 0);
    totalRevenue += parseFloat(s.totalSales?.revenue || 0);
    todaySales += (s.todaySales?.count || 0);
    todayRevenue += parseFloat(s.todaySales?.revenue || 0);
  }

  const perTotemCards = clientTotems.map(t => {
    const s = stats[t.id];
    if (!s) return '';
    const online = t.last_seen && (Date.now() - new Date(t.last_seen+'Z').getTime()) < 180000;
    return `<div class="stat-card">
      <div class="label">${t.name || t.id}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
        <span style="width:8px;height:8px;border-radius:50%;background:${online?'#22c55e':'#ef4444'}"></span>
        <span style="font-size:13px;color:#666;">${online?'Online':'Offline'}</span>
      </div>
      <div style="display:flex;gap:16px;margin-top:8px;">
        <div><span style="font-size:11px;color:#999;">Hoje</span><br><span style="font-weight:700;font-size:15px;">${s.todaySales?.count || 0}</span></div>
        <div><span style="font-size:11px;color:#999;">Total</span><br><span style="font-weight:700;font-size:15px;">${s.totalSales?.count || 0}</span></div>
        <div><span style="font-size:11px;color:#999;">Falhas</span><br><span style="font-weight:700;font-size:15px;color:#ef4444;">${s.failedCount?.count || 0}</span></div>
      </div>
    </div>`;
  }).join('');

  // ─── Telemetry cards (ao vivo) ───────────────────────
  function statusColor(val) {
    const n = parseFloat(val) || 0;
    return n >= 90 ? '#ef4444' : n >= 70 ? '#f59e0b' : '#22c55e';
  }
  function paperStatus(val) {
    const n = parseInt(val) || 0;
    return n > 20 ? '✅' : n > 10 ? '⚠️' : n > 0 ? '🔴' : '⛔';
  }

  const telCards = clientTotems.map(t => {
    const tel = telemetry[t.id] || {};
    const online = t.last_seen && (Date.now() - new Date(t.last_seen+'Z').getTime()) < 180000;
    const cpu = tel.cpu || '0';
    const ram = tel.ram || '0';
    const p10 = tel.paper_10x15 || '0';
    const p20 = tel.paper_15x20 || '0';
    const err = tel.printer_error || '';
    const cpuColor = statusColor(cpu);
    const ramColor = statusColor(ram);
    const timeStr = tel.created_at ? new Date(tel.created_at+'Z').toLocaleString('pt-BR') : '—';
    const errDisplay = err && err !== 'Sem erros' && err !== 'N/A' ? `⚠️ ${err}` : '✅ OK';

    return `<div class="tel-card" id="tel-${t.id}" data-totem="${t.id}">
      <div class="tel-header">
        <div class="tel-name">${t.name || t.id}</div>
        <span class="tel-dot" style="background:${online?'#22c55e':'#ef4444'}"></span>
        <span class="tel-online">${online?'Online':'Offline'}</span>
      </div>
      <div class="tel-body">
        <div class="tel-screenshot" id="scr-${t.id}">
          <div class="tel-noimg">Carregando...</div>
        </div>
        <div class="tel-info">
          <div class="tel-gauges">
            <div class="tel-gauge">
              <span class="tel-glabel">CPU</span>
              <div class="tel-bar"><div class="tel-fill" style="width:${Math.min(parseFloat(cpu),100)}%;background:${cpuColor}"></div></div>
              <span class="tel-gvalue" id="cpu-${t.id}">${cpu}%</span>
            </div>
            <div class="tel-gauge">
              <span class="tel-glabel">RAM</span>
              <div class="tel-bar"><div class="tel-fill" style="width:${Math.min(parseFloat(ram),100)}%;background:${ramColor}"></div></div>
              <span class="tel-gvalue" id="ram-${t.id}">${ram}%</span>
            </div>
          </div>
          <div class="tel-paper">
            <span>📄 10×15: <strong id="p10-${t.id}">${p10}</strong> ${paperStatus(p10)}</span>
            <span>15×20: <strong id="p20-${t.id}">${p20}</strong> ${paperStatus(p20)}</span>
          </div>
          <div class="tel-footer">
            <span class="tel-err" id="err-${t.id}">${errDisplay}</span>
            <span class="tel-time" id="time-${t.id}">🕐 ${timeStr}</span>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  const txRows = allTxs.map(t => {
    const items = JSON.parse(t.items || '[]');
    const itemStr = items.map(i => `${i.qty}x ${i.type}`).join(', ') || '—';
    return `<tr>
      <td>${t.totem_id || '—'}</td>
      <td>${t.created_at ? new Date(t.created_at+'Z').toLocaleString('pt-BR') : '—'}</td>
      <td>${t.code_id || '—'}</td>
      <td>${itemStr}</td>
      <td>${fmtMoney(t.total_value)}</td>
      <td><span class="badge badge-${t.status}">${t.status === 'completed' ? 'Aprovado' : 'Falha'}</span></td>
      <td>${methodLabels[t.payment_method] || t.payment_method}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" style="text-align:center;color:#999;padding:30px;">Nenhuma transação</td></tr>';

  return `
<div class="monitoring-grid">
  <div class="stat-card">
    <div class="label">Receita Total</div>
    <div class="value" style="color:#16a34a;">${fmtMoney(totalRevenue)}</div>
  </div>
  <div class="stat-card">
    <div class="label">Vendas Hoje</div>
    <div class="value">${todaySales}</div>
    <div style="font-size:12px;color:#888;">${fmtMoney(todayRevenue)}</div>
  </div>
  <div class="stat-card">
    <div class="label">Total de Vendas</div>
    <div class="value">${totalSales}</div>
  </div>
  <div class="stat-card">
    <div class="label">Totens</div>
    <div class="value">${clientTotems.length}</div>
  </div>
</div>

${clientTotems.length > 1 ? `
<h3 style="font-size:14px;font-weight:700;margin-bottom:12px;">Por Totem</h3>
<div class="monitoring-grid" style="margin-bottom:24px;">${perTotemCards}</div>` : ''}

<h3 style="font-size:14px;font-weight:700;margin-bottom:12px;margin-top:24px;">📡 Ao Vivo</h3>
<div id="telemetry-container" class="tel-grid">${telCards}</div>
<div style="text-align:center;margin:12px 0;">
  <button onclick="loadAllScreenshots()" style="padding:8px 20px;background:#d8232a;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">Carregar Screenshots</button>
  <span style="font-size:12px;color:#888;margin-left:12px;">Auto-refresh a cada 10s</span>
</div>

<div class="section">
  <h3>📋 Transações</h3>
  <table>
    <thead><tr><th>Totem</th><th>Data</th><th>Código</th><th>Itens</th><th>Valor</th><th>Status</th><th>Pagamento</th></tr></thead>
    <tbody>${txRows}</tbody>
  </table>
</div>

<script>
const TOTEM_IDS = ${JSON.stringify(clientTotems.map(t => t.id))};

async function loadScreenshot(totemId) {
  const scrDiv = document.getElementById('scr-' + totemId);
  if (!scrDiv) return;
  scrDiv.innerHTML = '<div class="tel-noimg">Carregando...</div>';
  try {
    const res = await fetch('/api/totem/telemetry/' + encodeURIComponent(totemId));
    const data = await res.json();
    if (data.success && data.screenshot) {
      scrDiv.innerHTML = '<img src="data:image/jpeg;base64,' + data.screenshot + '" alt="Screenshot" onerror="this.parentElement.innerHTML=\'<div class=tel-noimg>Erro ao carregar</div>\'">';
    } else {
      scrDiv.innerHTML = '<div class="tel-noimg">Nenhuma screenshot</div>';
    }
  } catch (e) {
    scrDiv.innerHTML = '<div class="tel-noimg">Erro de conexão</div>';
  }
}

async function loadAllScreenshots() {
  for (const id of TOTEM_IDS) {
    await loadScreenshot(id);
  }
}

async function refreshTelemetry() {
  try {
    for (const id of TOTEM_IDS) {
      const res = await fetch('/api/totem/telemetry/' + encodeURIComponent(id));
      const data = await res.json();
      if (data.success && data.telemetry) {
        const t = data.telemetry;
        const cpuEl = document.getElementById('cpu-' + id);
        const ramEl = document.getElementById('ram-' + id);
        const p10El = document.getElementById('p10-' + id);
        const p20El = document.getElementById('p20-' + id);
        const errEl = document.getElementById('err-' + id);
        const timeEl = document.getElementById('time-' + id);
        if (cpuEl) cpuEl.textContent = (t.cpu || '0') + '%';
        if (ramEl) ramEl.textContent = (t.ram || '0') + '%';
        if (p10El) p10El.textContent = t.paper_10x15 || '0';
        if (p20El) p20El.textContent = t.paper_15x20 || '0';
        if (errEl) {
          const e = t.printer_error || '';
          errEl.textContent = (e && e !== 'Sem erros' && e !== 'N/A') ? '⚠️ ' + e : '✅ OK';
        }
        if (timeEl && t.created_at) {
          timeEl.textContent = '🕐 ' + new Date(t.created_at + 'Z').toLocaleString('pt-BR');
        }
        // Update gauge bars
        const cpuFill = cpuEl?.closest('.tel-card')?.querySelector('.tel-gauge:nth-child(1) .tel-fill');
        const ramFill = ramEl?.closest('.tel-card')?.querySelector('.tel-gauge:nth-child(2) .tel-fill');
        const cpuVal = Math.min(parseFloat(t.cpu) || 0, 100);
        const ramVal = Math.min(parseFloat(t.ram) || 0, 100);
        if (cpuFill) { cpuFill.style.width = cpuVal + '%'; cpuFill.style.background = cpuVal >= 90 ? '#ef4444' : cpuVal >= 70 ? '#f59e0b' : '#22c55e'; }
        if (ramFill) { ramFill.style.width = ramVal + '%'; ramFill.style.background = ramVal >= 90 ? '#ef4444' : ramVal >= 70 ? '#f59e0b' : '#22c55e'; }
      }
    }
  } catch (e) {
    // silent
  }
}

// Auto-refresh stats a cada 10s, screenshots carregadas manualmente
setInterval(refreshTelemetry, 10000);
</script>`;
}

// ══════════════════════════════════════════════════════════
//  LIVE (dashboard estilo Python — dark theme, ao vivo)
// ══════════════════════════════════════════════════════════
function livePage(user, clientTotems) {
  const totemIds = clientTotems.map(t => t.id);
  const idsJson = JSON.stringify(totemIds);

  return `
<style>
.live-container{max-width:1400px;margin:0 auto;width:100%;}
.live-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;padding:16px 20px;background:linear-gradient(135deg,#1a1a24,#252535);border-radius:12px;border:1px solid #3a3a4a;}
.live-logo{display:flex;align-items:center;gap:10px;font-size:1.3rem;font-weight:700;background:linear-gradient(135deg,#6c5ce7,#8175ff);-webkit-background-clip:text;background-clip:text;color:transparent;}
.live-status{display:flex;gap:12px;}
.live-pill{background:rgba(30,30,45,.5);backdrop-filter:blur(12px);border-radius:50px;padding:6px 16px;font-size:.85rem;font-weight:500;border:1px solid rgba(255,255,255,.1);color:#f0f0ff;display:flex;align-items:center;gap:6px;}
.live-pill.live-warning{color:#ffaa00;background:rgba(255,170,0,.15);}
.live-pill.live-critical{color:#ff3d71;background:rgba(255,61,113,.15);}
.live-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-bottom:20px;}
.live-card{background:rgba(30,30,45,.5);backdrop-filter:blur(12px);border-radius:12px;border:1px solid rgba(255,255,255,.1);box-shadow:0 8px 24px rgba(0,0,0,.3);overflow:hidden;display:flex;flex-direction:column;height:480px;transition:.3s;}
.live-card:hover{transform:translateY(-4px);box-shadow:0 12px 40px rgba(0,0,0,.5);}
.live-card-id{font-size:1.1rem;font-weight:700;text-align:center;padding:12px;background:rgba(0,0,0,.25);color:#f0f0ff;}
.live-stats{display:flex;justify-content:space-around;padding:10px 12px;background:rgba(0,0,0,.1);}
.live-stat{text-align:center;padding:4px;}
.live-stat>div:first-child{font-size:.8rem;color:#c0c0e0;margin-bottom:4px;}
.live-stat-value{font-size:1.1rem;font-weight:600;}
.live-cpu{color:#6c5ce7;}
.live-paper-indicator{font-size:.75rem;margin-top:2px;}
.live-paper-good{color:#00e676;}
.live-paper-warning{color:#ffaa00;}
.live-paper-critical{color:#ff3d71;}
.live-screenshot{flex:1;display:flex;justify-content:center;align-items:center;background:#000;overflow:hidden;}
.live-screenshot img{width:auto;height:100%;object-fit:contain;}
.live-noimg{color:#666;font-size:.85rem;text-align:center;padding:20px;}
.live-timestamp{text-align:center;padding:8px;font-size:.8rem;color:#c0c0e0;background:rgba(0,0,0,.1);}
.live-footer{text-align:center;padding:16px;color:#c0c0e0;font-size:.85rem;border-top:1px solid rgba(255,255,255,.1);background:rgba(30,30,45,.3);backdrop-filter:blur(12px);border-radius:12px;}
.live-dot{width:8px;height:8px;border-radius:50%;display:inline-block;}
.live-dot.online{background-color:#00e676;}
.live-dot.offline{background-color:#ff3d71;}
@keyframes liveFade{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
.live-grid>*{animation:liveFade .5s ease-out both;}
</style>

<div class="live-container">
  <div class="live-header">
    <div class="live-logo">🖥️ Ao Vivo</div>
    <div class="live-status">
      <span class="live-pill"><span id="lv-total">0</span> Totens</span>
      <span class="live-pill live-warning" id="lv-warn-pill" style="display:none"><span id="lv-warn">0</span> Alertas</span>
      <span class="live-pill live-critical" id="lv-crit-pill" style="display:none"><span id="lv-crit">0</span> Críticos</span>
    </div>
  </div>

  <div id="lv-grid" class="live-grid"></div>

  <div class="live-footer">
    <span id="lv-server">🔌 Servidor: <span class="live-dot online"></span> Online</span>
  </div>
</div>

<script>
(function(){
const TOTEM_IDS = ${idsJson};
const TOTEM_NAMES = ${JSON.stringify(Object.fromEntries(clientTotems.map(t => [t.id, t.name || t.id])))};

function statusColor(v){const n=parseFloat(v)||0;return n>=90?'#ff3d71':n>=70?'#ffaa00':'#6c5ce7';}

function paperStatus(v){const n=parseInt(v)||0;if(n>20)return '<span class="live-paper-good">✔ Suficiente</span>';if(n>10)return '<span class="live-paper-warning">⚠ Atenção</span>';if(n>0)return '<span class="live-paper-warning">⚠ Pouco papel</span>';return '<span class="live-paper-critical">✖ Sem papel</span>';}

function renderCard(id, tel, scr){
  const cpu=tel.cpu||'0', ram=tel.ram||'0', p10=tel.paper_10x15||'0', p20=tel.paper_15x20||'0';
  const timeStr=tel.created_at?new Date(tel.created_at+'Z').toLocaleString('pt-BR'):'—';
  const scrHtml=scr?'<img src="data:image/jpeg;base64,'+scr+'" alt="Screen" onerror="this.parentElement.innerHTML=\'<div class=live-noimg>Erro</div>\'">':'<div class="live-noimg">Sem screenshot</div>';
  return '<div class="live-card">'+
    '<div class="live-card-id">'+TOTEM_NAMES[id]||id+'</div>'+
    '<div class="live-stats">'+
      '<div class="live-stat"><div>CPU</div><div class="live-stat-value live-cpu">'+cpu+'%</div></div>'+
      '<div class="live-stat"><div>10×15</div><div class="live-stat-value">'+p10+'</div><div class="live-paper-indicator">'+paperStatus(p10)+'</div></div>'+
      '<div class="live-stat"><div>15×20</div><div class="live-stat-value">'+p20+'</div><div class="live-paper-indicator">'+paperStatus(p20)+'</div></div>'+
    '</div>'+
    '<div class="live-screenshot">'+scrHtml+'</div>'+
    '<div class="live-timestamp">🕐 '+timeStr+'</div>'+
  '</div>';
}

async function refresh(){
  try{
    const res=await fetch('/api/totem/telemetry?ids='+TOTEM_IDS.join(','));
    const data=await res.json();
    if(!data.success) return;
    const grid=document.getElementById('lv-grid');
    if(!grid) return;
    let html='', warnings=0, criticals=0;
    for(const id of TOTEM_IDS){
      const tel=data.telemetry[id]||{};
      const scr=data.screenshots[id]||null;
      const cpu=parseFloat(tel.cpu)||0;
      if(cpu>=90) criticals++; else if(cpu>=70) warnings++;
      html+=renderCard(id, tel, scr);
    }
    grid.innerHTML=html;
    document.getElementById('lv-total').textContent=TOTEM_IDS.length;
    const w=document.getElementById('lv-warn'); if(w) w.textContent=warnings;
    const wp=document.getElementById('lv-warn-pill'); if(wp) wp.style.display=warnings>0?'':'none';
    const c=document.getElementById('lv-crit'); if(c) c.textContent=criticals;
    const cp=document.getElementById('lv-crit-pill'); if(cp) cp.style.display=criticals>0?'':'none';
  }catch(e){/*silent*/}
}

refresh();
setInterval(refresh, 10000);
})();
</script>`;
}
