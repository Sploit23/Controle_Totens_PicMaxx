const express = require('express');
const crypto = require('crypto');
const { getUserByEmail, getUserById, getUsers, createUser, updateUser,
        getTotems, getTotem, registerTotem,
        getTransactions, getStats,
        getClientConfig, setClientConfig,
        createLicense, getLicensesByUser, getLicenseByToken, getAllLicenses, updateLicense,
        hashPassword, verifyPassword } = require('../database');

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

  const clientTotems = getTotems().filter(t => t.user_id === user.id || !t.user_id);
  const totemIds = clientTotems.map(t => t.id);

  const statsAll = getStats();
  let totalSalesCount = 0, totalRevenue = 0, todayCount = 0, todayRevenue = 0;
  for (const tid of totemIds) {
    const s = getStats(tid);
    totalSalesCount += s.totalSales.count;
    totalRevenue += parseFloat(s.totalSales.revenue);
    todayCount += s.todaySales.count;
    todayRevenue += parseFloat(s.todaySales.revenue);
  }

  const recentTxs = [];
  for (const tid of totemIds) {
    recentTxs.push(...getTransactions(50, tid));
  }
  recentTxs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  recentTxs.splice(50);

  const config = getClientConfig(user.id);
  const licenses = getLicensesByUser(user.id);

  res.send(dashboardPage(user, clientTotems, { totalSalesCount, totalRevenue, todayCount, todayRevenue }, recentTxs, config, licenses));
});

// ─── API: SALVAR CONFIG ───────────────────────────────
router.post('/config', (req, res) => {
  const user = getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Nao autorizado' });

  const allowed = ['stone_code', 'mp_public_key', 'mp_access_token',
    'preco_10x15', 'preco_10x15_bulk', 'preco_10x15_threshold',
    'preco_15x20', 'preco_15x20_bulk', 'preco_15x20_threshold',
    'combo_enabled'];

  for (const [key, value] of Object.entries(req.body)) {
    if (allowed.includes(key)) {
      setClientConfig(user.id, key, value);
    }
  }
  log(req.rid, `Config salva: user=${user.id}`);
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

function dashboardPage(user, totems, stats, transactions, config, licenses) {
  const [y, m, d] = new Date().toISOString().slice(0,10).split('-');
  const dateStr = `${d}/${m}/${y}`;

  const fmt = (v) => parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  const fmtMoney = (v) => `R$ ${fmt(v)}`;

  const totemRows = totems.map(t => {
    const online = t.last_seen && (Date.now() - new Date(t.last_seen+'Z').getTime()) < 180000;
    return `<tr>
      <td><strong>${t.id}</strong></td>
      <td>${t.name || '—'}</td>
      <td>${t.last_seen ? new Date(t.last_seen+'Z').toLocaleString('pt-BR') : 'Nunca'}</td>
      <td><span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border-radius:50%;background:${online?'#22c55e':'#ef4444'}"></span>${online?'Online':'Offline'}</span></td>
    </tr>`;
  }).join('');

  const txRows = transactions.map(t => {
    const items = JSON.parse(t.items || '[]');
    const itemStr = items.map(i => `${i.qty}x ${i.type}`).join(', ') || '—';
    const methodLabels = { pix:'PIX', credit:'Crédito', debit:'Débito', test:'Teste', money:'Dinheiro', unknown:'—' };
    return `<tr>
      <td>${t.created_at ? new Date(t.created_at+'Z').toLocaleString('pt-BR') : '—'}</td>
      <td>${t.code_id || '—'}</td>
      <td>${itemStr}</td>
      <td>${fmtMoney(t.total_value)}</td>
      <td><span class="badge badge-${t.status}">${t.status === 'completed' ? 'Aprovado' : 'Falha'}</span></td>
      <td>${methodLabels[t.payment_method] || t.payment_method}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:#999;padding:30px;">Nenhuma transacao ainda</td></tr>';

  const licenseRows = licenses.map(l => {
    return `<tr>
      <td><code style="font-size:13px;background:#f0f0f0;padding:4px 8px;border-radius:6px;">${l.token}</code></td>
      <td>${l.totem_id || '—'}</td>
      <td>${l.expires_at ? new Date(l.expires_at+'Z').toLocaleDateString('pt-BR') : '—'}</td>
      <td><span class="badge badge-${l.active ? 'completed' : 'failed'}">${l.active ? 'Ativa' : 'Inativa'}</span></td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" style="text-align:center;color:#999;padding:30px;">Nenhuma licenca ainda</td></tr>';

  const comboChecked = config.combo_enabled === '1' ? 'checked' : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Minha Conta — ${user.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Inter',sans-serif; background:#f5f5f5; color:#1a1a1a; }
.header { background:#fff; border-bottom:1px solid #e5e5e5; padding:16px 32px; display:flex; align-items:center; justify-content:space-between; }
.header-left { display:flex; align-items:center; gap:12px; }
.header-logo { width:36px; height:36px; background:#d8232a; border-radius:10px; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:900; font-size:16px; }
.header h2 { font-size:18px; font-weight:700; }
.header-right { display:flex; align-items:center; gap:16px; }
.header-right span { color:#666; font-size:14px; }
.btn-logout { padding:8px 16px; background:transparent; border:1px solid #e0e0e0; border-radius:8px; cursor:pointer; font-size:13px; color:#666; text-decoration:none; transition:.2s; }
.btn-logout:hover { background:#f5f5f5; color:#d8232a; border-color:#d8232a; }
.container { max-width:1100px; margin:0 auto; padding:24px 32px; }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; margin-bottom:32px; }
.card { background:#fff; border-radius:16px; padding:20px 24px; box-shadow:0 2px 8px rgba(0,0,0,.04); }
.card-label { font-size:12px; font-weight:600; color:#999; text-transform:uppercase; letter-spacing:.5px; margin-bottom:4px; }
.card-value { font-size:28px; font-weight:900; color:#1a1a1a; }
.card-sub { font-size:12px; color:#999; margin-top:2px; }
.section { background:#fff; border-radius:16px; padding:24px; margin-bottom:24px; box-shadow:0 2px 8px rgba(0,0,0,.04); }
.section h3 { font-size:16px; font-weight:700; margin-bottom:16px; display:flex; align-items:center; gap:8px; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th { text-align:left; padding:10px 12px; border-bottom:2px solid #f0f0f0; color:#999; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.5px; }
td { padding:10px 12px; border-bottom:1px solid #f5f5f5; }
tr:hover td { background:#fafafa; }
.badge { display:inline-block; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:600; }
.badge-completed { background:#e8f5e9; color:#16a34a; }
.badge-failed { background:#fff0f0; color:#d8232a; }
.form-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.form-group { margin-bottom:4px; }
.form-group.full { grid-column:1/-1; }
.form-group label { display:block; font-size:12px; font-weight:600; color:#555; margin-bottom:4px; }
.form-group input, .form-group select { width:100%; padding:10px 12px; border:2px solid #e0e0e0; border-radius:10px; font-size:14px; outline:none; transition:.2s; }
.form-group input:focus { border-color:#d8232a; }
.form-group .hint { font-size:11px; color:#999; margin-top:2px; }
.toggle-row { display:flex; align-items:center; gap:12px; padding:10px 0; }
.toggle { width:44px; height:24px; background:#ccc; border-radius:12px; position:relative; cursor:pointer; transition:.2s; flex-shrink:0; }
.toggle.active { background:#d8232a; }
.toggle::after { content:''; position:absolute; top:2px; left:2px; width:20px; height:20px; background:#fff; border-radius:50%; transition:.2s; }
.toggle.active::after { left:22px; }
.toggle input { display:none; }
.btn-save { padding:12px 32px; background:#d8232a; color:#fff; font-size:15px; font-weight:700; border:none; border-radius:12px; cursor:pointer; transition:.2s; margin-top:8px; }
.btn-save:hover { background:#b81d23; }
.toast { display:none; position:fixed; bottom:32px; right:32px; background:#16a34a; color:#fff; padding:14px 24px; border-radius:12px; font-size:14px; font-weight:600; box-shadow:0 4px 20px rgba(0,0,0,.15); z-index:999; animation:slideUp .3s ease; }
@keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
.alert { background:#fff8e1; color:#b8860b; padding:12px 16px; border-radius:12px; font-size:13px; margin-bottom:16px; border:1px solid #ffe082; }
@media (max-width:700px) { .form-grid { grid-template-columns:1fr; } .container { padding:16px; } }
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

<div class="container">

<div style="margin-bottom:24px;">
  <h1 style="font-size:22px;font-weight:900;">Olá, ${user.name}!</h1>
  <p style="color:#666;font-size:14px;margin-top:4px;">${dateStr} · Plano <strong>${user.plan === 'basic' ? 'Basic' : user.plan}</strong></p>
</div>

<div class="cards">
  <div class="card">
    <div class="card-label">Totens</div>
    <div class="card-value">${totems.length}</div>
    <div class="card-sub">${totems.filter(t => t.last_seen && (Date.now() - new Date(t.last_seen+'Z').getTime()) < 180000).length} online</div>
  </div>
  <div class="card">
    <div class="card-label">Vendas Hoje</div>
    <div class="card-value">${stats.todayCount}</div>
    <div class="card-sub">${fmtMoney(stats.todayRevenue)}</div>
  </div>
  <div class="card">
    <div class="card-label">Faturamento Total</div>
    <div class="card-value">${fmtMoney(stats.totalRevenue)}</div>
    <div class="card-sub">${stats.totalSalesCount} vendas</div>
  </div>
  <div class="card">
    <div class="card-label">Licenças</div>
    <div class="card-value">${licenses.length}</div>
    <div class="card-sub">${licenses.filter(l => l.active).length} ativas</div>
  </div>
</div>

<div class="section">
  <h3>📟 Meus Totens</h3>
  ${totems.length === 0 ? '<div class="alert">Nenhum totem registrado ainda. Quando seu totem conectar, aparecera aqui.</div>' : `
  <table>
    <thead><tr><th>ID</th><th>Nome</th><th>Ultima vez</th><th>Status</th></tr></thead>
    <tbody>${totemRows}</tbody>
  </table>`}
</div>

<div class="section">
  <h3>⚙️ Configurações</h3>
  <div id="toast" class="toast">Salvo com sucesso!</div>
  <form id="configForm" class="form-grid">

    <div class="form-group full" style="border-bottom:1px solid #f0f0f0;padding-bottom:12px;margin-bottom:8px;">
      <h4 style="font-size:14px;font-weight:700;color:#333;">Pagamento</h4>
    </div>

    <div class="form-group">
      <label>Código Stone</label>
      <input type="text" name="stone_code" value="${config.stone_code || ''}" placeholder="Ex: 688912528">
      <div class="hint">Seu código de identificacao Stone</div>
    </div>

    <div class="form-group">
      <label>Mercado Pago — Public Key</label>
      <input type="text" name="mp_public_key" value="${config.mp_public_key || ''}" placeholder="Ex: APP_USR-...">
      <div class="hint">Chave publica do Mercado Pago</div>
    </div>

    <div class="form-group full">
      <label>Mercado Pago — Access Token</label>
      <input type="password" name="mp_access_token" value="${config.mp_access_token || ''}" placeholder="Deixe em branco para manter o atual" autocomplete="off">
      <div class="hint">Token de acesso do Mercado Pago</div>
    </div>

    <div class="form-group full" style="border-bottom:1px solid #f0f0f0;padding-bottom:12px;margin:8px 0;">
      <h4 style="font-size:14px;font-weight:700;color:#333;">Preços</h4>
    </div>

    <div class="form-group">
      <label>10×15 — Preço Unitário</label>
      <input type="number" step="0.01" name="preco_10x15" value="${config.preco_10x15 || '5.00'}" placeholder="5.00">
    </div>

    <div class="form-group">
      <label>15×20 — Preço Unitário</label>
      <input type="number" step="0.01" name="preco_15x20" value="${config.preco_15x20 || '10.00'}" placeholder="10.00">
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
      <div class="hint">Mostra "A partir de X unidades" com desconto no kiosk</div>
    </div>

    <div class="form-group">
      <label>Quantidade mínima para combo</label>
      <input type="number" name="preco_10x15_threshold" value="${config.preco_10x15_threshold || '5'}" placeholder="5">
      <div class="hint">Ex: "A partir de 5 unidades"</div>
    </div>

    <div class="form-group"></div>

    <div class="form-group">
      <label>10×15 — Preço Combo</label>
      <input type="number" step="0.01" name="preco_10x15_bulk" value="${config.preco_10x15_bulk || '5.00'}" placeholder="5.00">
    </div>

    <div class="form-group">
      <label>15×20 — Preço Combo</label>
      <input type="number" step="0.01" name="preco_15x20_bulk" value="${config.preco_15x20_bulk || '10.00'}" placeholder="10.00">
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

<div class="section">
  <h3>🔑 Licenças</h3>
  <table>
    <thead><tr><th>Token</th><th>Totem</th><th>Expira</th><th>Status</th></tr></thead>
    <tbody>${licenseRows}</tbody>
  </table>
</div>

<div style="text-align:center;padding:24px 0;color:#999;font-size:12px;">
  Revele Agora &copy; 2026 — Controle Maxx v1.0
</div>

</div>

<script>
document.getElementById('configForm').onsubmit = async function(e) {
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
</script>

</body>
</html>`;
}
