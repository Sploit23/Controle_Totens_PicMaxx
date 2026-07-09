const express = require('express');
const crypto = require('crypto');
const { getUserByEmail, getUserById, getUsers, createUser, updateUser,
        getTotems, getTotem, getTotemsByUser, registerTotem, getTotemConfig,
        getTransactions, getStats,
        getClientConfig, setClientConfig,
        createLicense, getLicensesByUser, getLicenseByToken, getAllLicenses, updateLicense,
        getLicenseByTotemId,
        hashPassword, verifyPassword, updateTotemName,
        getLatestScreenshot,
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
    let allTxs = [];
    for (const t of clientTotems) {
      const s = getStats(t.id);
      stats[t.id] = s;
      allTxs.push(...getTransactions(100, t.id));
    }
    allTxs.sort((a, b) => b.created_at.localeCompare(a.created_at));
    allTxs.splice(100);
    pageContent = monitoringPage(user, clientTotems, stats, allTxs);
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
function monitoringPage(user, clientTotems, stats, allTxs) {
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

<div class="section">
  <h3>📋 Transações</h3>
  <table>
    <thead><tr><th>Totem</th><th>Data</th><th>Código</th><th>Itens</th><th>Valor</th><th>Status</th><th>Pagamento</th></tr></thead>
    <tbody>${txRows}</tbody>
  </table>
</div>

`;
}

// ══════════════════════════════════════════════════════════
//  LIVE — igual ao `Servidor_antigo_Para_Integrar/public/`
// ══════════════════════════════════════════════════════════
function livePage(user, clientTotems) {
  const totemIds = clientTotems.map(t => t.id);
  const telemetry = getLatestTelemetryForTotems(totemIds);
  // monta totemData no formato que o JS antigo espera
  const totemData = {};
  for (const t of clientTotems) {
    const tel = telemetry[t.id] || {};
    const scr = getLatestScreenshot(t.id);
    totemData[t.id] = {
      id: t.id,
      paper_10x15: tel.paper_10x15 || '0',
      paper_15x20: tel.paper_15x20 || '0',
      printer_error: tel.printer_error || 'N/A',
      printer_name: tel.printer_name || 'N/A',
      screenshot: scr ? scr.screenshot : '',
      time: tel.created_at ? tel.created_at + 'Z' : new Date().toISOString()
    };
  }
  const initialDataJson = JSON.stringify(totemData).replace(/<\//g, '<\\/');
  const idsJson = JSON.stringify(totemIds);

  const debug = {
    totemIds,
    totemCount: clientTotems.length,
    telemetryKeys: Object.keys(totemData),
    hasTelemetry: Object.values(totemData).some(d => d.time !== new Date().toISOString()),
    totemDataPreview: Object.fromEntries(
      Object.entries(totemData).map(([k, v]) => [k, { ...v, screenshot: v.screenshot ? '(has ss)' : '(no ss)' }])
    )
  };

  return `<!-- SERVER DEBUG: ${JSON.stringify(debug)} -->
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg-primary:#0f0f13;--bg-secondary:#1a1a24;--bg-tertiary:#252535;--text-primary:#f0f0ff;--text-secondary:#c0c0e0;--accent-primary:#6c5ce7;--accent-secondary:#8175ff;--accent-gradient:linear-gradient(135deg,var(--accent-primary),var(--accent-secondary));--success:#00e676;--warning:#ffaa00;--danger:#ff3d71;--border-color:#3a3a4a;--shadow-color:rgba(0,0,0,.6);--card-shadow:0 8px 24px rgba(0,0,0,.3);--transition-speed:.3s;--glass-effect:rgba(30,30,45,.5);--glass-border:1px solid rgba(255,255,255,.1);--glass-blur:blur(12px)}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:var(--bg-primary);color:var(--text-primary);line-height:1.6;background-image:radial-gradient(circle at 25% 25%,rgba(108,92,231,0.15) 0%,transparent 50%),radial-gradient(circle at 75% 75%,rgba(255,61,113,0.1) 0%,transparent 50%);background-attachment:fixed}
.app-container{display:flex;flex-direction:column;min-height:100vh}
.main-header{background:var(--glass-effect);backdrop-filter:var(--glass-blur);padding:1rem 2rem;border-bottom:var(--glass-border);box-shadow:0 4px 30px var(--shadow-color);position:sticky;top:0;z-index:100}
.header-content{display:flex;justify-content:space-between;align-items:center;max-width:1400px;margin:0 auto;width:100%;gap:1rem}
.logo{display:flex;align-items:center;gap:.75rem;background:var(--accent-gradient);-webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:0 2px 10px rgba(108,92,231,.3)}
.logo i{font-size:1.8rem}
.logo h1{font-size:1.6rem;font-weight:700;letter-spacing:-.5px}
.system-status{display:flex;gap:1rem;align-items:center}
.status-pill{background:var(--glass-effect);backdrop-filter:var(--glass-blur);border-radius:50px;padding:.5rem 1.2rem;font-size:.85rem;font-weight:500;border:var(--glass-border);display:flex;align-items:center;gap:.5rem;transition:var(--transition-speed)}
.status-pill:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.2)}
#warning-status{color:var(--warning);background:rgba(255,170,0,.15)}
#critical-status{color:var(--danger);background:rgba(255,61,113,.15)}
.visualizacao-group{display:flex;align-items:center;gap:.5rem;background:var(--glass-effect);backdrop-filter:var(--glass-blur);border-radius:50px;padding:.5rem 1rem;border:var(--glass-border)}
.visualizacao-label{font-size:.85rem;font-weight:500;color:var(--text-secondary)}
.visualizacao-group .view-option{background:transparent;border:1px solid rgba(255,255,255,.2);color:var(--text-secondary);border-radius:50px;padding:.3rem .8rem;font-size:.8rem;cursor:pointer;transition:var(--transition-speed);font-weight:500}
.visualizacao-group .view-option.active{background:var(--accent-gradient);border-color:var(--accent-primary);color:#fff}
.visualizacao-group .view-option:hover{border-color:var(--accent-primary);color:var(--text-primary)}
.filtro-periodo-group,.total-vendas-group{display:none}
main{flex:1;padding:2rem;max-width:1400px;margin:0 auto;width:100%}
.grid-view{display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:1.5rem;width:100%;max-width:2000px;margin:0 auto;padding:0 .5rem 1.5rem .5rem;box-sizing:border-box;justify-content:center;align-items:flex-start}
.totem-card{background:var(--bg-secondary);border-radius:12px;overflow:hidden;box-shadow:var(--card-shadow);border:var(--glass-border);transition:all var(--transition-speed);display:flex;flex-direction:column;height:500px;position:relative}
.totem-card:hover{transform:translateY(-5px);box-shadow:0 12px 28px rgba(0,0,0,.4)}
.totem-id{position:absolute;top:0;left:0;right:0;font-size:1.2rem;font-weight:700;color:#fff;padding:.8rem;background:rgba(0,0,0,.7);backdrop-filter:blur(5px);text-align:center;z-index:10;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:12px 12px 0 0}
.totem-content{display:flex;flex-direction:row;width:100%;min-width:0;gap:0;flex:1}
.resource-info{display:flex;flex-direction:column;flex:0 0 110px;min-width:0;max-width:120px;width:100%}
.screenshot-container{flex:1;min-width:0;width:100%;display:flex;align-items:center;justify-content:center;background:#000}
.screenshot-container img{width:100%;height:auto;max-width:100%;object-fit:contain;border-radius:.2rem}
.totem-card:hover .screenshot-container img{transform:scale(1.03)}
.timestamp{position:absolute;bottom:0;left:0;right:0;text-align:center;font-size:.7rem;color:var(--text-secondary);padding:.5rem;background:rgba(0,0,0,.5);z-index:5}
.resource-stats{display:flex;flex-direction:column;gap:.8rem}
.resource-stat{padding:.6rem;border-radius:6px;margin-bottom:.8rem;transition:var(--transition-speed);background:rgba(15,15,19,.6)}
.stat-label{font-size:.75rem;color:var(--text-secondary);margin-bottom:.2rem}
.stat-value{font-size:1.1rem;font-weight:600}
.cpu-stat.normal{border-left:3px solid var(--accent-primary)}
.cpu-stat.warning{border-left:3px solid var(--warning);background:rgba(255,170,0,.1)}
.cpu-stat.critical{border-left:3px solid var(--danger);background:rgba(255,61,113,.1)}
.paper-stat.high{border-left:3px solid var(--success);background:rgba(0,230,118,.1)}
.paper-stat.medium{border-left:3px solid var(--warning);background:rgba(255,170,0,.1)}
.paper-stat.low{border-left:3px solid var(--warning);background:rgba(255,170,0,.2)}
.paper-stat.critical{background:rgba(255,61,113,.3)!important;border:1px solid var(--danger)!important;color:#fff!important;animation:pulseWarning 2s infinite}
.paper-stat.critical .stat-value{color:#fff!important;font-weight:700}
.paper-stat.critical .paper-indicator{display:none}
@keyframes pulseWarning{0%{opacity:1}50%{opacity:.8}100%{opacity:1}}
footer{text-align:center;padding:1rem;border-top:var(--glass-border);color:var(--text-secondary);font-size:.85rem;background:var(--glass-effect);backdrop-filter:var(--glass-blur)}
#server-status{display:inline-flex;align-items:center;gap:.5rem}
.status-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.status-dot.online{background-color:var(--success);box-shadow:0 0 8px var(--success)}
.status-dot.offline{background-color:var(--danger);box-shadow:0 0 8px var(--danger)}
.totem-status-badge{position:absolute;bottom:10px;right:10px;padding:.4rem .9rem;font-weight:700;border-radius:20px;font-size:.8rem;z-index:15;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.8);border:2px solid rgba(255,255,255,.2);backdrop-filter:blur(4px);transition:all .3s ease;text-transform:uppercase;letter-spacing:.5px;min-width:70px;text-align:center}
.totem-status-badge.online{background:linear-gradient(135deg,#00e676,#00c853);box-shadow:0 4px 15px rgba(0,230,118,.4),0 0 20px rgba(0,230,118,.2);animation:subtleGlow 3s ease-in-out infinite}
.totem-status-badge.offline{background:linear-gradient(135deg,#ff1744,#d50000);box-shadow:0 4px 15px rgba(255,23,68,.6),0 0 25px rgba(255,23,68,.3);animation:pulseOfflineIntense 1.2s infinite}
@keyframes subtleGlow{0%,100%{box-shadow:0 4px 15px rgba(0,230,118,.4),0 0 20px rgba(0,230,118,.2)}50%{box-shadow:0 4px 20px rgba(0,230,118,.6),0 0 30px rgba(0,230,118,.4)}}
@keyframes pulseOfflineIntense{0%,100%{transform:scale(1);box-shadow:0 4px 15px rgba(255,23,68,.6),0 0 25px rgba(255,23,68,.3)}50%{transform:scale(1.08);box-shadow:0 6px 25px rgba(255,23,68,.8),0 0 40px rgba(255,23,68,.5)}}
.totem-status-badge:hover{transform:scale(1.05);cursor:pointer}
.totem-status-badge.online::before{content:"\\25CF ";font-size:.6rem;margin-right:.2rem}
.totem-status-badge.offline::before{content:"\\26A0 ";font-size:.7rem;margin-right:.2rem}
#no-results{text-align:center;padding:3rem;color:var(--text-secondary)}
.hidden{display:none!important}
@media(max-width:768px){.header-content{flex-direction:column;gap:1rem}.system-status{width:100%;justify-content:center;flex-wrap:wrap}.grid-view{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}}
@media(max-width:480px){.grid-view{grid-template-columns:1fr}}
.full-totem-header{display:flex;align-items:center;justify-content:center;padding:.85rem 1.3rem;border-top-left-radius:1.1rem;border-top-right-radius:1.1rem;font-size:1.04rem;font-weight:800;letter-spacing:.7px;margin-bottom:0;background:rgba(30,30,45,.85);backdrop-filter:blur(6px) saturate(1.2);box-shadow:0 2px 16px rgba(0,0,0,.1);border-bottom:1.5px solid rgba(255,255,255,.08);transition:background .3s,color .3s}
.full-totem-title{color:#fff;text-shadow:0 2px 12px #000a,0 1px 0 #1ed76044;font-size:1.04em;font-weight:800;letter-spacing:.7px;text-transform:uppercase;text-align:center;flex:1;transition:color .3s,text-shadow .3s}
.header-status-online{background:linear-gradient(90deg,#1ed760cc 0%,#1ed76033 100%),rgba(30,30,45,.45);color:#fff}
.header-status-offline{background:linear-gradient(90deg,#ff3d71cc 0%,#ff3d7133 100%),rgba(30,30,45,.45);color:#fff}
.card-full-online{border:2.5px solid #1ed760;box-shadow:0 0 24px #1ed76055,0 0 0 1.5px #fff1 inset;transition:border .3s,box-shadow .3s}
.card-full-offline{border:2.5px solid #ff3d71;box-shadow:0 0 24px #ff3d7188,0 0 0 1.5px #fff1 inset;transition:border .3s,box-shadow .3s}
.full-totem-card{width:100%;min-width:280px;max-width:350px;margin:0 auto;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start}
</style>
<div class="app-container">
  <header class="main-header">
    <div class="header-content">
      <div class="logo">
        <i class="fas fa-desktop"></i>
        <h1>Monitor de Totens</h1>
      </div>
      <div class="system-status">
        <div class="status-pill"><span id="total-count">0</span> Totens</div>
        <div class="status-pill" id="warning-status" style="display:none"><span id="warning-count">0</span> Alertas</div>
        <div class="status-pill" id="critical-status" style="display:none"><span id="critical-count">0</span> Críticos</div>
      </div>
    </div>
  </header>
  <main>
    <div id="totems-container" class="grid-view"></div>
    <div id="no-results" class="hidden">
      <i class="fas fa-search"></i>
      <p>Nenhum totem encontrado</p>
    </div>
  </main>
  <footer>
    <p>Painel de Monitoramento de Totens \u00a9 2025 | 
       <span id="server-status">Servidor: <span class="status-dot online"></span> Online</span>
    </p>
  </footer>
</div>
<div id="js-status" style="background:#ff0;color:#000;padding:8px;text-align:center;font-weight:bold;font-size:14px;">⏳ JS carregando...</div>
<script>
var TOTEM_IDS = ${idsJson};
document.getElementById('js-status').textContent = '✅ JS rodou! Totens: '+TOTEM_IDS.length+' ('+TOTEM_IDS.join(', ')+')';
console.log('[Ao Vivo] TOTEM_IDS:', TOTEM_IDS);
var DEBUG = document.createElement('div');
DEBUG.id='debug-info';DEBUG.style.cssText='font-size:11px;color:#888;padding:4px 1rem;text-align:center;border-top:1px solid rgba(255,255,255,.05)';
document.body.appendChild(DEBUG);
function updateDebug(){DEBUG.textContent='Totens: '+TOTEM_IDS.length+' ('+TOTEM_IDS.join(', ')+') | Telemetria: '+Object.keys(totemData).length+' cards'}
var PAPER_HIGH = 100, PAPER_MEDIUM = 70, PAPER_LOW = 30;
var OFFLINE_TIMEOUT = 30;
var totemData = {};
var totalCount = document.getElementById('total-count');
var warningCount = document.getElementById('warning-count');
var criticalCount = document.getElementById('critical-count');
var serverStatus = document.getElementById('server-status');
var connectedTotems = new Set();

function getPaperLevel(count){var n=parseInt(count)||0;if(n===0)return'critical';if(n<=PAPER_LOW)return'low';if(n<=PAPER_MEDIUM)return'medium';return'high'}
function getPaperStatus(count){var n=parseInt(count)||0;if(n===0)return'Vazio';if(n<=PAPER_LOW)return'Baixo';if(n<=PAPER_MEDIUM)return'M\u00e9dio';return'Alto'}
function getResourceStatus(value){var n=parseInt(value)||0;if(n>=90)return'critical';if(n>=70)return'warning';return'normal'}

function renderFullTotem(id){
  var data=totemData[id];if(!data)return;
  var now=Date.now(),last=new Date(data.time).getTime(),diff=(now-last)/1000;
  var paperEmpty=(parseInt(data.paper_10x15)===0||parseInt(data.paper_15x20)===0);
  var offline=diff>OFFLINE_TIMEOUT||paperEmpty;
  var sc=offline?'offline':'online',st=offline?'OFFLINE':'ONLINE';
  var p10l=getPaperLevel(data.paper_10x15),p20l=getPaperLevel(data.paper_15x20);
  var card=document.createElement('div');card.id='totem-'+id;
  card.className='totem-card full-totem-card card-full-'+sc;
  card.innerHTML='<div class="full-totem-header header-status-'+sc+'"><span class="full-totem-title">'+id+'</span></div>'+
    '<div class="totem-content">'+
      '<div class="resource-info"><div class="resource-stats">'+
        '<div class="resource-stat paper-stat '+p10l+'"><div class="stat-label">Papel 10x15</div><div class="stat-value">'+(data.paper_10x15||'0')+'</div><div class="paper-indicator">'+getPaperStatus(data.paper_10x15)+'</div></div>'+
        '<div class="resource-stat paper-stat '+p20l+'"><div class="stat-label">Papel 15x20</div><div class="stat-value">'+(data.paper_15x20||'0')+'</div><div class="paper-indicator">'+getPaperStatus(data.paper_15x20)+'</div></div>'+
      '</div><div class="timestamp">Atualizado: '+new Date(data.time).toLocaleTimeString('pt-BR')+'</div></div>'+
      '<div class="screenshot-container"><img src="data:image/jpeg;base64,'+data.screenshot+'" alt="Tela do totem"></div>'+
    '</div>';
  var img = card.querySelector('.screenshot-container img');
  if(img) img.onerror = function(){this.parentElement.innerHTML='<div style=color:#666;font-size:.85rem;padding:20px;>Sem screenshot</div>';};
  var old=document.getElementById('totem-'+id);if(old)old.replaceWith(card);else document.getElementById('totems-container').appendChild(card);
}

function updateStatusCounts(){
  var total=0,warnings=0,criticals=0,now=Date.now();
  for(var k in totemData){
    total++;
    var last=new Date(totemData[k].time).getTime(),diff=(now-last)/1000;
    var paperEmpty=(parseInt(totemData[k].paper_10x15)===0||parseInt(totemData[k].paper_15x20)===0);
    if(diff>OFFLINE_TIMEOUT||paperEmpty) criticals++;
    else if(parseInt(totemData[k].paper_10x15)<=PAPER_LOW||parseInt(totemData[k].paper_15x20)<=PAPER_LOW) warnings++;
  }
  totalCount.textContent=total;
  warningCount.textContent=warnings;
  criticalCount.textContent=criticals;
  document.getElementById('warning-status').style.display=warnings>0?'':'none';
  document.getElementById('critical-status').style.display=criticals>0?'':'none';
  updateDebug();
}

function updateServerStatus(online){
  var d=serverStatus.querySelector('.status-dot');
  d.className='status-dot '+(online?'online':'offline');
}

  function updateTotemCard(id){
  try{
    renderFullTotem(id);
  }catch(e){
    console.error('[Ao Vivo] renderFullTotem error for', id, e);
    var js = document.getElementById('js-status');
    if(js) js.textContent = '❌ Erro renderFullTotem('+id+'): '+e.message;
  }
}

function initData(data){
  console.log('[Ao Vivo] initData keys:', Object.keys(data));
  for(var k in data){totemData[k]=data[k]}
  for(var k in totemData){
    try{
      renderFullTotem(k);
    }catch(e){
      console.error('[Ao Vivo] renderFullTotem error', k, e);
      var js = document.getElementById('js-status');
      if(js) js.textContent = '❌ Erro renderFullTotem('+k+'): '+e.message;
    }
  }
  updateStatusCounts();
  updateServerStatus(true);
  updateDebug();
  var js = document.getElementById('js-status');
  if(js) js.textContent = '✅ initData OK - '+Object.keys(totemData).length+' cards renderizados';
}

var initialData = ${initialDataJson};
try{
  console.log('[Ao Vivo] initialData:', JSON.stringify(initialData));
  initData(initialData);
}catch(e){
  console.error('[Ao Vivo] initData:', e);
  var js = document.getElementById('js-status');
  if(js) js.textContent = '❌ initData error: '+e.message;
}

async function poll(){
  try{
    var ids=TOTEM_IDS.map(function(id){return encodeURIComponent(id)}).join(',');
    var res=await fetch('/api/totem/telemetry?ids='+ids);
    var json=await res.json();
    if(!json.success) return;
    var changed=false;
    for(var i=0;i<TOTEM_IDS.length;i++){
      var id=TOTEM_IDS[i];
      if(json.telemetry[id]){
        var t=json.telemetry[id];
        totemData[id].paper_10x15=t.paper_10x15||'0';
        totemData[id].paper_15x20=t.paper_15x20||'0';
        totemData[id].printer_error=t.printer_error||'N/A';
        totemData[id].time=t.created_at?t.created_at+'Z':new Date().toISOString();
        if(json.screenshots[id]){totemData[id].screenshot=json.screenshots[id]}
        updateTotemCard(id);
        changed=true;
      }
    }
    if(changed){updateStatusCounts();updateServerStatus(true)}
    updateDebug();
  }catch(e){console.error('[Ao Vivo]',e);updateServerStatus(false);updateDebug()}
}

setInterval(poll,10000);
<\/script>`;
}
