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
        getLatestTelemetryForTotems,
        createCoupon, getCouponsByUser, getCouponStats, toggleCouponActive, getCouponUsageCount } = require('../database');
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

  const page = req.query.page || 'dashboard';
  const selectedTotemId = req.query.totem || '';
  const clientTotems = getTotemsByUser(user.id);
  const licenses = getLicensesByUser(user.id);
  const config = getClientConfig(user.id);

  // Variaveis compartilhadas
  let pageTitle = 'Dashboard', pageContent = '';

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
  } else if (page === 'coupons') {
    pageTitle = '🎟️ Cupons';
    pageContent = couponsPage(user, clientTotems);
  } else if (page === 'live') {
    pageTitle = 'Ao Vivo';
    pageContent = livePage(user, clientTotems);
  } else if (page === 'kiosk') {
    pageContent = kioskListPage(user, clientTotems, config);
  } else {
    // Dashboard (default)
    pageTitle = 'Dashboard';
    const globalStats = getStats();
    pageContent = dashboardPage(user, clientTotems, globalStats);
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

// ─── API: ATUALIZAR DADOS DA CONTA ──────────────────────
router.post('/update-account', (req, res) => {
  const user = getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Nao autorizado' });

  const { name, email } = req.body;

  const updates = {};

  if (name && name.trim()) {
    updates.name = name.trim();
  }

  if (email && email.trim()) {
    const existing = getUserByEmail(email.trim());
    if (existing && existing.id !== user.id) {
      return res.status(400).json({ error: 'Este email ja esta em uso por outro usuario' });
    }
    updates.email = email.trim();
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nenhum dado para atualizar' });
  }

  updateUser(user.id, updates);
  log(req.rid, `Conta atualizada: usuario ${user.id} -> ${JSON.stringify(updates)}`);

  // Atualizar sessão com novo nome/email
  const updated = getUserById(user.id);
  req.session.name = updated.name;
  req.session.email = updated.email;

  res.json({ success: true, name: updated.name, email: updated.email });
});

// ─── API: TESTAR NOTIFICAÇÃO ────────────────────────────
const nodemailer = require('nodemailer');

router.post('/test-notification', async (req, res) => {
  try {
    const user = getUserById(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Nao autorizado' });

    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Informe um email' });
    }

    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT) || 587;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM;
    const fromName = process.env.SMTP_FROM_NAME || 'Maxx Print - Monitoramento';

    if (!host || !smtpUser || !smtpPass) {
      return res.status(500).json({ error: 'SMTP nao configurado no servidor' });
    }

    const smtpPort = port || 587;
    const useSecure = smtpPort === 465;
    const transporter = nodemailer.createTransport({
      host,
      port: smtpPort,
      secure: useSecure,
      auth: { user: smtpUser, pass: smtpPass },
      tls: { rejectUnauthorized: false },
    });

    const totems = getTotemsByUser(user.id);
    const totemList = totems.length > 0
      ? totems.map(t => `<tr><td style="padding:6px 10px;border:1px solid #eee;">${t.name || t.id}</td><td style="padding:6px 10px;border:1px solid #eee;color:#888;">${t.id}</td></tr>`).join('')
      : '<tr><td style="padding:10px;text-align:center;color:#999;">Nenhum totem vinculado</td></tr>';

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <div style="text-align:center;padding:16px 0">
          <h1 style="margin:0;font-size:48px">✅</h1>
          <h2 style="color:#00A6C0;margin:8px 0 0">Teste de Notificação</h2>
          <p style="color:#666;font-size:14px;">Este é um teste do sistema de alertas do seu totem</p>
        </div>

        <div style="background:#f8f9fa;border-radius:8px;padding:16px 20px;margin:16px 0">
          <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>Cliente:</strong> ${user.name}</p>
          <p style="margin:0;font-size:14px;color:#555;"><strong>Email cadastrado:</strong> ${email}</p>
        </div>

        <h3 style="font-size:15px;margin:16px 0 8px;">📡 Seus Totens</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="background:#f5f5f5;"><th style="padding:6px 10px;border:1px solid #eee;text-align:left;">Nome</th><th style="padding:6px 10px;border:1px solid #eee;text-align:left;">ID</th></tr></thead>
          <tbody>${totemList}</tbody>
        </table>

        <h3 style="font-size:15px;margin:20px 0 8px;">🔔 Alertas que você receberá</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="background:#f5f5f5;"><th style="padding:8px 10px;border:1px solid #eee;text-align:left;">Alerta</th><th style="padding:8px 10px;border:1px solid #eee;text-align:left;">Quando ocorre</th></tr></thead>
          <tbody>
            <tr><td style="padding:8px 10px;border:1px solid #eee;">🔴 Totem Offline</td><td style="padding:8px 10px;border:1px solid #eee;">Quando o totem fica mais de 90s sem se comunicar</td></tr>
            <tr><td style="padding:8px 10px;border:1px solid #eee;">🟢 Totem Online Novamente</td><td style="padding:8px 10px;border:1px solid #eee;">Quando o totem volta a ficar online após ficar offline</td></tr>
            <tr><td style="padding:8px 10px;border:1px solid #eee;">📋 Papel 10×15 Baixo</td><td style="padding:8px 10px;border:1px solid #eee;">Quando restam menos de 10 folhas de papel 10×15</td></tr>
            <tr><td style="padding:8px 10px;border:1px solid #eee;">📋 Papel 15×20 Baixo</td><td style="padding:8px 10px;border:1px solid #eee;">Quando restam menos de 10 folhas de papel 15×20</td></tr>
            <tr><td style="padding:8px 10px;border:1px solid #eee;">🖨️ Erro na Impressora</td><td style="padding:8px 10px;border:1px solid #eee;">Quando o totem reporta erro na impressora</td></tr>
          </tbody>
        </table>

        <p style="font-size:12px;color:#999;margin-top:20px;text-align:center;">
          Você receberá no máximo 1 notificação do mesmo tipo a cada 30 minutos.<br>
          Este é um envio automático do sistema de monitoramento Kiosk de Fotos / Maxx Print.
        </p>
      </div>
    `;

    await transporter.sendMail({
      from: `"${fromName}" <${from}>`,
      to: email.trim(),
      subject: `[Maxx Print] ✅ Teste de Notificação — ${user.name}`,
      html,
    });

    log(req.rid, `Test notification enviado para ${email} (usuario ${user.id})`);
    res.json({ success: true });
  } catch (e) {
    console.error('[Test-Notification] Erro:', e.message);
    res.status(500).json({ error: e.message || 'Erro ao enviar email de teste' });
  }
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>Minha Conta - Controle Maxx</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Inter',system-ui,sans-serif;background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}
.card{background:#fff;border-radius:20px;padding:48px 36px;width:100%;max-width:400px;box-shadow:0 25px 60px rgba(0,0,0,.5);text-align:center;}
.logo{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:8px;}
.logo-icon{width:48px;height:48px;background:#d8232a;border-radius:14px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:22px;}
.logo-text{font-size:26px;font-weight:800;color:#1a1a2e;letter-spacing:-.5px;}
.logo-text span{color:#d8232a;}
.sub{color:#888;font-size:14px;margin-bottom:32px;}
.form-group{margin-bottom:18px;text-align:left;}
label{display:block;font-size:13px;font-weight:600;color:#444;margin-bottom:6px;}
input{width:100%;padding:13px 16px;border:2px solid #e0e0e0;border-radius:12px;font-size:15px;transition:border-color .2s;outline:none;font-family:inherit;}
input:focus{border-color:#d8232a;}
.btn{width:100%;padding:14px;border:none;border-radius:12px;font-size:16px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#d8232a,#b81d23);color:#fff;transition:opacity .2s;margin-top:8px;font-family:inherit;}
.btn:hover{opacity:.9;}
.error{background:#fef2f2;color:#dc2626;padding:12px;border-radius:10px;font-size:14px;margin-bottom:20px;font-weight:500;}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="logo-icon">R</div>
    <div class="logo-text">Minha <span>Conta</span></div>
  </div>
  <p class="sub">Acesse seu painel de controle</p>
  ${error ? `<div class="error">${error}</div>` : ''}
  <form method="post">
    <div class="form-group"><label>Email</label><input type="email" name="email" placeholder="seu@email.com" required autofocus></div>
    <div class="form-group"><label>Senha</label><input type="password" name="password" placeholder="••••••••" required></div>
    <button class="btn">Entrar</button>
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

// ─── CSS DESIGN SYSTEM ─────────────────────────────────
const CSS = `
:root {
  --bg: #f0f2f5; --bg-card: #ffffff; --bg-sidebar: #1a1a2e; --bg-sidebar-hover: #16213e;
  --bg-input: #f8f9fa; --border: #e0e0e0; --border-focus: #d8232a;
  --text: #1e293b; --text-secondary: #64748b; --text-sidebar: #cbd5e1; --text-sidebar-active: #ffffff;
  --primary: #d8232a; --primary-hover: #b81d23; --primary-light: #fef2f2;
  --success: #10b981; --success-light: #ecfdf5;
  --danger: #ef4444; --danger-light: #fef2f2; --danger-hover: #dc2626;
  --warning: #f59e0b; --warning-light: #fffbeb;
  --shadow: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04);
  --shadow-lg: 0 10px 25px rgba(0,0,0,.08);
  --radius: 12px; --radius-lg: 16px;
  --sidebar-w: 260px;
  --transition: all .2s ease;
}
[data-theme="dark"] {
  --bg: #0f172a; --bg-card: #1e293b; --bg-sidebar: #0f172a; --bg-sidebar-hover: #1e293b;
  --bg-input: #334155; --border: #334155; --border-focus: #f87171;
  --text: #f1f5f9; --text-secondary: #94a3b8; --text-sidebar: #94a3b8; --text-sidebar-active: #ffffff;
  --primary-light: #7f1d1d; --success-light: #064e3b; --danger-light: #7f1d1d; --warning-light: #78350f;
  --shadow: 0 1px 3px rgba(0,0,0,.2); --shadow-lg: 0 10px 25px rgba(0,0,0,.3);
}
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background:var(--bg); color:var(--text); min-height:100vh; }
a { color:var(--primary); text-decoration:none; }
a:hover { text-decoration:underline; }
.sidebar {
  position:fixed; top:0; left:0; width:var(--sidebar-w); height:100vh; background:var(--bg-sidebar);
  padding:0; z-index:200; transition:transform .3s ease; display:flex; flex-direction:column;
  border-right:1px solid rgba(255,255,255,.06); transform:translateX(-100%);
}
.sidebar.open { transform:translateX(0); }
.sidebar-backdrop {
  display:none; position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:190;
  backdrop-filter:blur(2px); -webkit-backdrop-filter:blur(2px);
}
body.sidebar-open .sidebar-backdrop { display:block; }
body.sidebar-open { overflow:hidden; }
.sidebar-logo { padding:24px 20px 20px; display:flex; align-items:center; gap:12px; border-bottom:1px solid rgba(255,255,255,.06); }
.sidebar-logo .logo-icon { width:38px; height:38px; background:var(--primary); border-radius:10px; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:900; font-size:16px; flex-shrink:0; }
.sidebar-logo .logo-text { font-size:18px; font-weight:800; color:#fff; letter-spacing:-.5px; }
.sidebar-nav { flex:1; padding:12px 10px; overflow-y:auto; }
.sidebar-nav a {
  display:flex; align-items:center; gap:12px; padding:12px 16px; border-radius:10px;
  color:var(--text-sidebar); font-size:14px; font-weight:500; transition:var(--transition);
  text-decoration:none; margin-bottom:2px;
}
.sidebar-nav a:hover { background:var(--bg-sidebar-hover); color:var(--text-sidebar-active); text-decoration:none; }
.sidebar-nav a.active { background:var(--primary); color:#fff; font-weight:600; }
.sidebar-nav a .icon { font-size:18px; width:24px; text-align:center; }
.sidebar-footer {
  padding:16px 20px; border-top:1px solid rgba(255,255,255,.06);
  display:flex; align-items:center; gap:10px;
}
.sidebar-footer .avatar {
  width:36px; height:36px; border-radius:10px; background:var(--primary); color:#fff;
  display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; flex-shrink:0;
}
.sidebar-footer .user-info { flex:1; min-width:0; }
.sidebar-footer .user-info .name { color:#fff; font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sidebar-footer .user-info .role { color:var(--text-sidebar); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.main { margin-left:0; min-height:100vh; }
.topbar {
  background:var(--bg-card); border-bottom:1px solid var(--border); padding:0 28px; height:64px;
  display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100;
}
.topbar-title { font-size:18px; font-weight:700; }
.topbar-actions { display:flex; align-items:center; gap:12px; }
.hamburger {
  display:block; background:none; border:none; font-size:24px; cursor:pointer; color:var(--text);
  padding:8px; border-radius:8px;
}
.hamburger:hover { background:var(--bg-input); }
.btn-theme {
  background:none; border:1px solid var(--border); border-radius:10px; padding:8px 12px;
  cursor:pointer; font-size:16px; transition:var(--transition); color:var(--text);
}
.btn-theme:hover { border-color:var(--primary); background:var(--primary-light); }
.btn-logout {
  padding:8px 16px; border:none; border-radius:10px; font-size:13px; font-weight:600;
  cursor:pointer; background:var(--danger-light); color:var(--danger); transition:var(--transition);
  text-decoration:none;
}
.btn-logout:hover { background:var(--danger); color:#fff; text-decoration:none; }
.content { padding:28px; max-width:1400px; }
.stats-grid {
  display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:16px; margin-bottom:24px;
}
.stat-card {
  background:var(--bg-card); border-radius:var(--radius-lg); padding:16px 20px;
  box-shadow:var(--shadow); border:1px solid var(--border); transition:var(--transition);
}
.stat-card:hover { box-shadow:var(--shadow-lg); transform:translateY(-1px); }
.stat-card .label { font-size:11px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:.5px; }
.stat-card .value { font-size:22px; font-weight:900; color:var(--text); margin-top:2px; }
.stat-card .sub-label { font-size:11px; color:var(--text-secondary); margin-top:2px; }
.section {
  background:var(--bg-card); border-radius:var(--radius-lg); padding:24px;
  margin-bottom:24px; box-shadow:var(--shadow); border:1px solid var(--border);
}
.section h3 { font-size:16px; font-weight:700; margin-bottom:16px; display:flex; align-items:center; gap:8px; }
.section-header {
  display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;
}
.section-header h2 { font-size:18px; font-weight:700; display:flex; align-items:center; gap:8px; }
.section-header .count { font-size:13px; font-weight:400; color:var(--text-secondary); }
.table-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; }
table { width:100%; border-collapse:collapse; min-width:500px; }
th {
  text-align:left; padding:10px 12px; font-size:11px; font-weight:600; color:var(--text-secondary);
  text-transform:uppercase; letter-spacing:.3px; border-bottom:2px solid var(--border);
  white-space:nowrap;
}
td { padding:10px 12px; font-size:13px; border-bottom:1px solid var(--border); vertical-align:middle; }
tr:hover td { background:var(--bg-input); }
.cell-mono { font-family:'SF Mono','Fira Code',monospace; font-size:12px; }
.badge {
  display:inline-block; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:600; white-space:nowrap;
}
.badge-completed, .badge-ok { background:var(--success-light); color:var(--success); }
.badge-failed, .badge-fail { background:var(--danger-light); color:var(--danger); }
.badge-info { background:var(--primary-light); color:var(--primary); }
.badge-warn { background:var(--warning-light); color:var(--warning); }
.btn {
  padding:10px 20px; border:none; border-radius:10px; font-size:13px; font-weight:600;
  cursor:pointer; transition:var(--transition); display:inline-flex; align-items:center; gap:6px;
  white-space:nowrap; font-family:inherit;
}
.btn-primary { background:var(--primary); color:#fff; }
.btn-primary:hover { background:var(--primary-hover); }
.btn-success { background:var(--success); color:#fff; }
.btn-danger { background:var(--danger); color:#fff; }
.btn-outline {
  background:transparent; border:1px solid var(--border); color:var(--text-secondary);
}
.btn-outline:hover { border-color:var(--primary); color:var(--primary); background:var(--primary-light); }
.btn-sm { padding:6px 12px; font-size:12px; border-radius:8px; }
.btn-save {
  padding:12px 32px; background:var(--primary); color:#fff; font-size:15px; font-weight:700;
  border:none; border-radius:12px; cursor:pointer; transition:var(--transition); margin-top:8px; font-family:inherit;
}
.btn-save:hover { background:var(--primary-hover); }
.btn-back {
  padding:8px 16px; background:transparent; border:1px solid var(--border); border-radius:8px;
  cursor:pointer; font-size:13px; color:var(--text-secondary); text-decoration:none;
  transition:var(--transition); display:inline-flex; align-items:center; gap:6px;
}
.btn-back:hover { color:var(--primary); border-color:var(--primary); text-decoration:none; }
.form-group { margin-bottom:14px; }
.form-group label { display:block; font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:4px; }
.form-group.full { grid-column:1/-1; }
.form-input, .form-group input, .form-group select {
  width:100%; padding:10px 12px; border:2px solid var(--border); border-radius:10px;
  font-size:14px; background:var(--bg-input); color:var(--text); transition:var(--transition); outline:none;
  font-family:inherit;
}
.form-input:focus, .form-group input:focus, .form-group select:focus { border-color:var(--border-focus); }
.form-group .hint { font-size:11px; color:var(--text-secondary); margin-top:2px; }
.form-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.toggle-row { display:flex; align-items:center; gap:12px; padding:10px 0; }
.toggle {
  width:44px; height:24px; background:#ccc; border-radius:12px; position:relative;
  cursor:pointer; transition:var(--transition); flex-shrink:0;
}
.toggle.active { background:var(--primary); }
.toggle::after {
  content:''; position:absolute; top:2px; left:2px; width:20px; height:20px;
  background:#fff; border-radius:50%; transition:var(--transition);
}
.toggle.active::after { left:22px; }
.toggle input { display:none; }
.modal-overlay {
  display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:300;
  align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(4px);
}
.modal-overlay.active { display:flex; }
.modal {
  background:var(--bg-card); border-radius:var(--radius-lg); padding:28px; width:100%;
  max-width:520px; box-shadow:var(--shadow-lg); border:1px solid var(--border);
  max-height:90vh; overflow-y:auto;
}
.modal h3 { font-size:18px; font-weight:700; margin-bottom:20px; }
.modal-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:24px; }
.toast {
  position:fixed; bottom:24px; right:24px; padding:14px 20px; border-radius:12px;
  font-size:14px; font-weight:600; z-index:400; transform:translateY(100px);
  opacity:0; transition:all .3s ease; box-shadow:var(--shadow-lg);
  background:var(--success); color:#fff;
}
.toast.show { transform:translateY(0); opacity:1; }
.toast.error { background:var(--danger); }
.toast-inline { display:none; position:fixed; bottom:32px; right:32px; background:var(--success); color:#fff; padding:14px 24px; border-radius:12px; font-size:14px; font-weight:600; box-shadow:var(--shadow-lg); z-index:999; animation:slideUp .3s ease; }
@keyframes slideUp{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}
.empty { text-align:center; padding:48px 20px; color:var(--text-secondary); font-size:14px; }
.empty .empty-icon { font-size:40px; margin-bottom:12px; opacity:.5; }
.search-box { position:relative; max-width:320px; }
.search-box input {
  width:100%; padding:10px 14px 10px 38px; border:1px solid var(--border); border-radius:10px;
  font-size:14px; background:var(--bg-input); color:var(--text); outline:none; transition:var(--transition);
}
.search-box input:focus { border-color:var(--border-focus); box-shadow:0 0 0 3px rgba(216,35,42,.1); }
.search-box .search-icon {
  position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-secondary); font-size:14px;
}
.alert { background:var(--warning-light); color:#b8860b; padding:12px 16px; border-radius:12px; font-size:13px; margin-bottom:16px; border:1px solid var(--warning); }
.totem-card {
  display:flex; align-items:center; gap:16px; padding:16px; border-radius:var(--radius);
  background:var(--bg-card); border:1px solid var(--border); cursor:pointer; transition:var(--transition);
  text-decoration:none; color:inherit; margin-bottom:8px;
}
.totem-card:hover { border-color:var(--primary); box-shadow:var(--shadow-lg); text-decoration:none; }
.totem-card .status-dot { width:12px; height:12px; border-radius:50%; flex-shrink:0; }
.totem-card .info { flex:1; }
.totem-card .info strong { font-size:15px; }
.totem-card .info .sub { font-size:12px; color:var(--text-secondary); margin-top:2px; }
.monitoring-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; margin-bottom:24px; }
.tel-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(420px,1fr)); gap:16px; margin-bottom:24px; }
.tel-card { background:var(--bg-card); border-radius:var(--radius); padding:16px; box-shadow:var(--shadow); border:1px solid var(--border); }
.tel-header { display:flex; align-items:center; gap:8px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid var(--border); }
.tel-name { font-size:15px; font-weight:700; flex:1; }
.tel-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
.tel-online { font-size:12px; color:var(--text-secondary); }
.tel-body { display:grid; grid-template-columns:200px 1fr; gap:16px; }
.tel-screenshot { width:200px; height:150px; border-radius:8px; overflow:hidden; background:var(--bg-input); display:flex; align-items:center; justify-content:center; }
.tel-screenshot img { width:100%; height:100%; object-fit:cover; }
.tel-noimg { font-size:12px; color:var(--text-secondary); text-align:center; padding:8px; }
.tel-info { display:flex; flex-direction:column; gap:10px; }
.tel-gauges { display:flex; flex-direction:column; gap:6px; }
.tel-gauge { display:flex; align-items:center; gap:8px; }
.tel-glabel { font-size:12px; font-weight:600; color:var(--text-secondary); min-width:32px; }
.tel-bar { flex:1; height:16px; background:var(--border); border-radius:8px; overflow:hidden; }
.tel-fill { height:100%; border-radius:8px; transition:width .5s,background .3s; min-width:4px; max-width:100%; }
.tel-gvalue { font-size:13px; font-weight:700; min-width:44px; text-align:right; color:var(--text); }
.tel-paper { display:flex; gap:16px; font-size:13px; color:var(--text-secondary); flex-wrap:wrap; }
.tel-footer { display:flex; justify-content:space-between; align-items:center; margin-top:4px; font-size:12px; }
.tel-err { color:var(--text-secondary); }
@media (max-width:768px) {
  .content { padding:16px; }
  .stats-grid { grid-template-columns:1fr 1fr; gap:10px; }
  .stat-card { padding:14px; }
  .stat-card .value { font-size:18px; }
  .section { padding:16px; }
  .section-header { flex-direction:column; align-items:flex-start; }
  .topbar { padding:0 16px; }
  .modal { max-width:100%; margin:10px; }
  table { min-width:400px; }
  .form-grid { grid-template-columns:1fr; }
  .tel-grid { grid-template-columns:1fr; }
  .tel-body { grid-template-columns:1fr; }
  .tel-screenshot { width:100%; height:200px; }
}
@media (max-width:480px) {
  .stats-grid { grid-template-columns:1fr; }
  .tel-body { grid-template-columns:1fr; }
}
`;

function getThemeScript() {
  return `<script>
(function(){
  window.toggleTheme = function(){
    var current = document.documentElement.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch(e) {}
  };
  window.closeSidebar = function(){
    var sb = document.getElementById('sidebar');
    if(sb) sb.classList.remove('open');
    document.body.classList.remove('sidebar-open');
  };
  window.openSidebar = function(){
    var sb = document.getElementById('sidebar');
    if(sb) sb.classList.add('open');
    document.body.classList.add('sidebar-open');
  };
  window.toggleSidebar = function(){
    var sb = document.getElementById('sidebar');
    if(!sb) return;
    if(sb.classList.contains('open')) window.closeSidebar();
    else window.openSidebar();
  };
  window.showToast = function(msg, type){
    var t = document.getElementById('global-toast');
    if(!t) return;
    t.textContent = msg;
    t.className = 'toast ' + (type||'') + ' show';
    setTimeout(function(){ t.className = 'toast'; }, 3000);
  };
  window.openModal = function(id){ document.getElementById(id).classList.add('active'); };
  window.closeModal = function(id){ document.getElementById(id).classList.remove('active'); };
  window.closeAllModals = function(){ document.querySelectorAll('.modal-overlay').forEach(function(m){m.classList.remove('active');}); };
  window.filterTable = function(inputId, tableId){
    var q = document.getElementById(inputId).value.toLowerCase();
    var rows = document.querySelectorAll('#'+tableId+' tbody tr');
    rows.forEach(function(r){
      r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  };
  var hamburger = document.getElementById('hamburger-btn');
  if(hamburger) hamburger.addEventListener('click', function(e){ e.stopPropagation(); toggleSidebar(); });
  var themeBtn = document.getElementById('theme-btn');
  if(themeBtn) themeBtn.addEventListener('click', function(){ toggleTheme(); });
  var backdrop = document.querySelector('.sidebar-backdrop');
  if(backdrop) backdrop.addEventListener('click', function(){ closeSidebar(); });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') closeSidebar();
  });
  document.querySelectorAll('.sidebar-nav a').forEach(function(a){
    a.addEventListener('click', function(){ closeSidebar(); });
  });
  document.querySelectorAll('.modal-overlay').forEach(function(el){
    el.addEventListener('click', function(e){ if(e.target === el) el.classList.remove('active'); });
  });
  var params = new URLSearchParams(window.location.search);
  var s = params.get('success'), er = params.get('error');
  if(s) showToast(s.replace(/\\+/g,' '), 'success');
  if(er) showToast(er.replace(/\\+/g,' '), 'error');
  if(s || er) {
    var url = new URL(window.location);
    url.searchParams.delete('success');
    url.searchParams.delete('error');
    window.history.replaceState({},'',url);
  }
})();
</script>`;
}

function sidebarHTML(active, user) {
  var nav = [
    { href: '/client', icon: '&#9632;', label: 'Dashboard', id: 'dashboard' },
    { href: '/client?page=kiosk', icon: '&#9787;', label: 'Kiosks', id: 'kiosk' },
    { href: '/client?page=licenses', icon: '&#9830;', label: 'Licencas', id: 'licenses' },
    { href: '/client?page=settings', icon: '&#9881;', label: 'Cadastros', id: 'settings' },
    { href: '/client?page=monitoring', icon: '&#9673;', label: 'Monitoramento', id: 'monitoring' },
    { href: '/client?page=coupons', icon: '&#10003;', label: 'Cupons', id: 'coupons' },
    { href: '/client?page=live', icon: '&#9678;', label: 'Ao Vivo', id: 'live' },
  ];
  var userName = user ? user.name : 'Conta';
  var userEmail = user ? user.email : '';
  var initial = userName.charAt(0).toUpperCase();
  return `<aside class="sidebar" id="sidebar">
    <div class="sidebar-logo">
      <div class="logo-icon">R</div>
      <div class="logo-text">Minha <span>Conta</span></div>
    </div>
    <nav class="sidebar-nav">
      ${nav.map(function(n){ return '<a href="'+n.href+'" class="'+(active===n.id?'active':'')+'"><span class="icon">'+n.icon+'</span>'+n.label+'</a>'; }).join('')}
    </nav>
    <div class="sidebar-footer">
      <div class="avatar">${initial}</div>
      <div class="user-info">
        <div class="name">${userName}</div>
        <div class="role">${userEmail}</div>
      </div>
    </div>
  </aside>`;
}

function topbarHTML(title) {
  return `<header class="topbar">
    <div style="display:flex;align-items:center;gap:12px;">
      <button class="hamburger" id="hamburger-btn">&#9776; <span style="font-size:13px;font-weight:600;">Menu</span></button>
      <span class="topbar-title">${title}</span>
    </div>
    <div class="topbar-actions">
      <button class="btn-theme" id="theme-btn" title="Alternar tema">&#9789;</button>
      <a href="/client/logout" class="btn-logout">Sair</a>
    </div>
  </header>`;
}

// ─── LAYOUT ──────────────────────────────────────────────
function layoutPage(user, activePage, pageTitle, pageContent) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>${pageTitle} — ${user.name}</title>
<style>${CSS}</style>
<script>
try { document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'light'); } catch(e) {}
</script>
</head>
<body>
<div class="sidebar-backdrop"></div>
${sidebarHTML(activePage, user)}
<div class="main">
  ${topbarHTML(pageTitle)}
  <div class="content">
    ${pageContent}
    <div style="text-align:center;padding:24px 0;color:var(--text-secondary);font-size:12px;">
      Revele Agora &copy; 2026 — Controle Maxx
    </div>
  </div>
</div>
<div id="global-toast" class="toast"></div>
${getThemeScript()}
</body>
</html>`;
}
// ─── DASHBOARD PAGE ─────────────────────────────────────
function dashboardPage(user, clientTotems, globalStats) {
  const online = t => t.last_seen && (Date.now() - new Date(t.last_seen+'Z').getTime()) < 180000;
  const onlineCount = clientTotems.filter(t => online(t)).length;
  const offlineCount = clientTotems.length - onlineCount;

  const todayCount = globalStats.todaySales.count || 0;
  const todayRevenue = parseFloat(globalStats.todaySales.revenue || 0);
  const totalRevenue = parseFloat(globalStats.totalSales.revenue || 0);
  const totalSales = globalStats.totalSales.count || 0;

  const recentTxs = [];
  for (const t of clientTotems) {
    const txs = getTransactions(5, t.id);
    for (const tx of txs) tx._totemName = t.name || t.id;
    recentTxs.push(...txs);
  }
  recentTxs.sort((a, b) => b.created_at.localeCompare(a.created_at));
  recentTxs.splice(5);

  const methodLabels = { pix:'PIX', credit:'Credito', debit:'Debito', test:'Teste', money:'Dinheiro', unknown:'-' };

  const txRows = recentTxs.map(t => {
    const items = JSON.parse(t.items || '[]');
    const itemStr = items.map(i => i.qty + 'x ' + i.type).join(', ') || '-';
    return `<tr>
      <td>${t._totemName || '-'}</td>
      <td>${t.created_at ? new Date(t.created_at+'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-'}</td>
      <td>${itemStr}</td>
      <td>${fmtMoney(t.total_value)}</td>
      <td><span class="badge badge-${t.status}">${t.status === 'completed' ? 'Aprovado' : 'Falha'}</span></td>
      <td>${methodLabels[t.payment_method] || t.payment_method}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:30px;">Nenhuma transacao ainda</td></tr>';

  const totemList = clientTotems.map(t => {
    const isOnline = online(t);
    return `<a href="/client?page=kiosk&totem=${t.id}" class="totem-card">
      <span class="status-dot" style="background:${isOnline?'#22c55e':'#ef4444'}"></span>
      <div class="info">
        <strong>${t.name || t.id}</strong>
        <div class="sub">${isOnline ? 'Online' : 'Offline'} &middot; ${t.last_seen ? new Date(t.last_seen+'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Nunca conectou'}</div>
      </div>
      <span style="font-size:20px;color:var(--border);">&#8250;</span>
    </a>`;
  }).join('') || '<div class="alert">Nenhum totem registrado ainda.</div>';

  return `
<div class="stats-grid">
  <div class="stat-card">
    <div class="label">Totens</div>
    <div class="value">${clientTotems.length}</div>
    <div class="sub-label">${onlineCount} online &middot; ${offlineCount} offline</div>
  </div>
  <div class="stat-card">
    <div class="label">Vendas Hoje</div>
    <div class="value">${todayCount}</div>
    <div class="sub-label">${fmtMoney(todayRevenue)}</div>
  </div>
  <div class="stat-card">
    <div class="label">Receita Total</div>
    <div class="value">${fmtMoney(totalRevenue)}</div>
    <div class="sub-label">${totalSales} vendas</div>
  </div>
  <div class="stat-card">
    <div class="label">Online Agora</div>
    <div class="value" style="color:${onlineCount > 0 ? 'var(--success)' : 'var(--danger)'};">${onlineCount}</div>
    <div class="sub-label">de ${clientTotems.length} totens</div>
  </div>
</div>

<div class="section">
  <div class="section-header">
    <h3>Seus Totens</h3>
    <a href="/client?page=kiosk" class="btn btn-outline btn-sm">Ver todos</a>
  </div>
  ${totemList}
</div>

${recentTxs.length > 0 ? `
<div class="section">
  <div class="section-header">
    <h3>Ultimas Transacoes</h3>
    <a href="/client?page=monitoring" class="btn btn-outline btn-sm">Ver todas</a>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Totem</th><th>Data</th><th>Itens</th><th>Valor</th><th>Status</th><th>Pagamento</th></tr></thead>
      <tbody>${txRows}</tbody>
    </table>
  </div>
</div>` : ''}
`;
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
        <div class="sub">${isOnline ? 'Online' : 'Offline'} · ${t.last_seen ? 'Visto em ' + new Date(t.last_seen+'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Nunca conectou'}</div>
      </div>
      <span style="font-size:20px;color:#ccc;">›</span>
    </a>`;
  }).join('') || '<div class="alert">Nenhum totem registrado. Quando seu totem conectar, aparecerá aqui.</div>';

  const onlineCount = clientTotems.filter(t => online(t)).length;

  return `
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;">
  <div class="stat-card">
    <div class="label">Totens</div>
    <div class="value">${clientTotems.length}</div>
    <div class="sub-label">${onlineCount} online</div>
  </div>
  <div class="stat-card">
    <div class="label">Offline</div>
    <div class="value">${clientTotems.length - onlineCount}</div>
    <div class="sub-label">há mais de 3 min</div>
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
      <td>${t.created_at ? new Date(t.created_at+'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}</td>
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
  <div class="stat-card">
    <div class="label">ID</div>
    <div style="font-size:16px;font-weight:700;color:#1a1a1a;margin-top:2px;">${totem.id}</div>
  </div>
  <div class="stat-card">
    <div class="label">Status</div>
    <div style="display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;color:#1a1a1a;margin-top:2px;">
      <span style="width:10px;height:10px;border-radius:50%;background:${online?'#22c55e':'#ef4444'}"></span>${online?'Online':'Offline'}
    </div>
  </div>
  <div class="stat-card">
    <div class="label">Vendas Hoje</div>
    <div class="value">${stats.todaySales.count}</div>
    <div class="sub-label">${fmtMoney(stats.todaySales.revenue)}</div>
  </div>
  <div class="stat-card">
    <div class="label">Total</div>
    <div class="value">${stats.totalSales.count}</div>
    <div class="sub-label">${fmtMoney(stats.totalSales.revenue)}</div>
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
      <span>${totem.last_seen ? new Date(totem.last_seen+'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Nunca'}</span>
    </div>
    <div style="display:flex;align-items:center;gap:12px;">
      <span style="font-weight:600;font-size:14px;color:#555;min-width:80px;">Licença:</span>
      <span>${license ? `<code style="background:#f0f0f0;padding:2px 8px;border-radius:4px;font-size:12px;">${license.token}</code> <span style="font-size:12px;color:#888;">(${license.active ? 'Ativa' : 'Inativa'})</span>` : '—'}</span>
    </div>
  </div>
</div>

<div class="section">
  <h3>⚙️ Configurações — ${totem.name || totem.id}</h3>
  <div id="toast" class="toast-inline">Salvo com sucesso!</div>

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
  <div class="stat-card">
    <div class="label">Total</div>
    <div class="value">${total}</div>
  </div>
  <div class="stat-card">
    <div class="label">Ativas</div>
    <div style="font-size:22px;font-weight:900;color:#16a34a;margin-top:2px;">${active}</div>
  </div>
  <div class="stat-card">
    <div class="label">Inativas</div>
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

  <div id="toast" class="toast-inline">Salvo com sucesso!</div>

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
  <div id="account-toast" class="toast">Salvo com sucesso!</div>

  <form id="accountForm" class="form-grid">
    <div class="form-group">
      <label for="acc-name">Nome</label>
      <input type="text" id="acc-name" value="${escapeHtml(user.name)}" placeholder="Seu nome">
    </div>
    <div class="form-group">
      <label for="acc-email">Email <strong style="color:#d8232a;">(notificações)</strong></label>
      <div style="display:flex;gap:8px;">
        <input type="email" id="acc-email" value="${user.email}" placeholder="seu@email.com" style="flex:1;">
        <button type="button" id="btn-test-email" onclick="testNotification()" style="padding:10px 16px;background:#00A6C0;color:#fff;font-weight:700;border:none;border-radius:10px;cursor:pointer;white-space:nowrap;font-size:13px;">Testar</button>
      </div>
      <div class="hint">Para onde os alertas do totem serão enviados</div>
      <div id="test-email-status" style="font-size:12px;margin-top:4px;"></div>
    </div>
    <div class="form-group full">
      <button type="submit" class="btn-save">Salvar Dados</button>
    </div>
  </form>

  <div style="margin-top:16px;padding:12px 16px;background:#f0f7ff;border:1px solid #cce5ff;border-radius:12px;font-size:13px;color:#0066cc;">
    <strong>ℹ️ Sobre as notificações:</strong> Os alertas de <strong>totem offline</strong>, <strong>papel baixo</strong> e <strong>erro na impressora</strong> serão enviados automaticamente para o email cadastrado aqui.
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

document.getElementById('accountForm').onsubmit = async function(e) {
  e.preventDefault();
  const data = {
    name: document.getElementById('acc-name').value,
    email: document.getElementById('acc-email').value,
  };
  const res = await fetch('/client/update-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const result = await res.json();
  if (result.error) {
    alert(result.error);
    return;
  }
  // Atualizar nome na navbar
  const toast = document.getElementById('account-toast');
  toast.textContent = 'Dados salvos com sucesso!';
  toast.style.display = 'block';
  setTimeout(() => toast.style.display = 'none', 2500);
};

async function testNotification() {
  const email = document.getElementById('acc-email').value.trim();
  if (!email) {
    alert('Informe um email primeiro');
    return;
  }
  const btn = document.getElementById('btn-test-email');
  const status = document.getElementById('test-email-status');
  btn.disabled = true;
  btn.textContent = 'Enviando...';
  status.innerHTML = '<span style="color:#888;">Enviando email de teste...</span>';
  try {
    const res = await fetch('/client/test-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (data.error) {
      status.innerHTML = '<span style="color:#ef4444;">❌ ' + data.error + '</span>';
    } else {
      status.innerHTML = '<span style="color:#16a34a;">✅ Email de teste enviado! Verifique sua caixa de entrada.</span>';
    }
  } catch (e) {
    status.innerHTML = '<span style="color:#ef4444;">❌ Erro de rede</span>';
  }
  btn.disabled = false;
  btn.textContent = 'Testar';
}
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
      <td>${t.created_at ? new Date(t.created_at+'Z').toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}</td>
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

// ─── API: CRIAR CUPOM ────────────────────────────────────
router.post('/coupons/create', (req, res) => {
  const user = getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });

  const { code, description, discountType, discountValue, quantity, sizeAllowed, expiresAt, maxUses, maxUsesPerCpf, totemIds } = req.body;
  if (!code || !code.trim()) return res.status(400).json({ error: 'Código do cupom obrigatório' });

  try {
    const id = createCoupon(user.id, {
      code: code.trim().toUpperCase(),
      description: description || '',
      discountType: discountType || 'free_photo',
      discountValue: parseFloat(discountValue) || 100,
      quantity: parseInt(quantity) || 1,
      sizeAllowed: sizeAllowed || 'both',
      expiresAt: expiresAt || null,
      maxUses: parseInt(maxUses) || null,
      maxUsesPerCpf: parseInt(maxUsesPerCpf) || 1,
      totemIds: totemIds || [],
    });
    log(req.rid, `Cupom criado: ${code.trim().toUpperCase()} (usuario ${user.id})`);
    res.json({ success: true, id });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Já existe um cupom com este código' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ─── API: ATIVAR/DESATIVAR CUPOM ─────────────────────────
router.post('/coupons/toggle/:id', (req, res) => {
  const user = getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });
  toggleCouponActive(parseInt(req.params.id));
  log(req.rid, `Cupom ${req.params.id} toggled (usuario ${user.id})`);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════
//  COUPONS PAGE
// ══════════════════════════════════════════════════════════
function couponsPage(user, clientTotems) {
  const coupons = getCouponsByUser(user.id);

  const couponRows = coupons.map(c => {
    const used = getCouponUsageCount(c.id);
    const maxStr = c.max_uses ? `/${c.max_uses}` : '/∞';
    const typeLabel = c.discount_type === 'free_photo' ? '🆓 Grátis' : '½ ' + c.discount_value + '%';
    const qtyLabel = c.quantity > 1 ? ` ×${c.quantity}` : '';
    const sizeLabel = { '10x15': '10×15', '15x20': '15×20', 'both': 'Ambos' }[c.size_allowed] || c.size_allowed;
    const expired = c.expires_at && new Date(c.expires_at) < new Date();
    const statusDot = c.active && !expired ? '🟢' : '🔴';
    return `<tr>
      <td><code style="background:#f0f0f0;padding:4px 8px;border-radius:6px;font-size:13px;">${c.code}</code></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;">${c.description || '—'}</td>
      <td>${typeLabel}${qtyLabel}</td>
      <td>${sizeLabel}</td>
      <td>${c.expires_at ? new Date(c.expires_at+'Z').toLocaleDateString('pt-BR') : '—'}</td>
      <td><strong>${used}${maxStr}</strong></td>
      <td>${statusDot} ${expired ? 'Expirado' : c.active ? 'Ativo' : 'Inativo'}</td>
      <td><button onclick="toggleCoupon(${c.id})" style="padding:6px 14px;border:1px solid #ccc;border-radius:6px;background:transparent;cursor:pointer;font-size:12px;">${c.active ? 'Desativar' : 'Ativar'}</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:#999;padding:30px;">Nenhum cupom criado ainda.</td></tr>';

  const totemOptions = clientTotems.map(t =>
    `<label style="display:flex;align-items:center;gap:6px;padding:4px 0;"><input type="checkbox" class="totem-check" value="${t.id}"> ${t.name || t.id}</label>`
  ).join('');

  return `
<div class="section">
  <h3>➕ Criar Novo Cupom</h3>
  <p style="font-size:13px;color:#888;margin-bottom:16px;">Crie cupons de desconto para divulgar seu totem. O cliente digita o código no kiosk junto com o CPF.</p>

  <div id="coupon-toast" class="toast">Cupom criado com sucesso!</div>

  <form id="couponForm" class="form-grid" style="margin-top:8px;">
    <div class="form-group">
      <label>Código do Cupom *</label>
      <input type="text" id="cup-code" placeholder="Ex: COCACOLA" style="text-transform:uppercase;font-weight:700;letter-spacing:2px;" required>
      <div class="hint">O cliente digitará este código no kiosk</div>
    </div>
    <div class="form-group">
      <label>Descrição</label>
      <input type="text" id="cup-desc" placeholder="Ex: Parceria Coca-Cola">
    </div>
    <div class="form-group">
      <label>Tipo de Desconto</label>
      <select id="cup-type">
        <option value="free_photo">🎁 Foto Grátis</option>
        <option value="percentage">½ Porcentagem (%)</option>
      </select>
    </div>
    <div class="form-group" id="cup-value-group">
      <label>Valor do Desconto</label>
      <input type="number" id="cup-value" value="100" min="1" max="100">
      <div class="hint">100% = foto grátis. Se for %, o valor percentual.</div>
    </div>
    <div class="form-group">
      <label>Tamanho Permitido</label>
      <select id="cup-size">
        <option value="both">10×15 e 15×20</option>
        <option value="10x15">Só 10×15</option>
        <option value="15x20">Só 15×20</option>
      </select>
    </div>
    <div class="form-group">
      <label>Quantidade de Fotos</label>
      <input type="number" id="cup-qty" value="1" min="1" max="99">
      <div class="hint">Quantas fotos o cupom cobre (ex: 2 fotos grátis)</div>
    </div>
    <div class="form-group">
      <label>Validade</label>
      <input type="date" id="cup-expires">
      <div class="hint">Deixe em branco para não expirar</div>
    </div>
    <div class="form-group">
      <label>Usos Máximos</label>
      <input type="number" id="cup-max" placeholder="0 = ilimitado" min="0">
    </div>
    <div class="form-group">
      <label>Usos por CPF</label>
      <input type="number" id="cup-cpf" value="1" min="1">
    </div>
    <div class="form-group full">
      <label>Totens (deixe vazio = todos os seus totens)</label>
      <div style="display:flex;flex-wrap:wrap;gap:8px;padding:8px 0;">
        ${totemOptions || '<span style="color:#999;">Nenhum totem vinculado</span>'}
      </div>
    </div>
    <div class="form-group full">
      <button type="submit" class="btn-save">Criar Cupom</button>
    </div>
  </form>
</div>

<div class="section">
  <h3>📋 Cupons</h3>
  <table>
    <thead><tr><th>Código</th><th>Descrição</th><th>Tipo</th><th>Tamanho</th><th>Expira</th><th>Usos</th><th>Status</th><th></th></tr></thead>
    <tbody>${couponRows}</tbody>
  </table>
</div>

<script>
document.getElementById('cup-type').onchange = function() {
  const grp = document.getElementById('cup-value-group');
  grp.style.display = this.value === 'free_photo' ? 'none' : '';
  if (this.value === 'free_photo') document.getElementById('cup-value').value = 100;
};

document.getElementById('couponForm').onsubmit = async function(e) {
  e.preventDefault();
  const totemIds = Array.from(document.querySelectorAll('.totem-check:checked')).map(cb => cb.value);
  const data = {
    code: document.getElementById('cup-code').value,
    description: document.getElementById('cup-desc').value,
    discountType: document.getElementById('cup-type').value,
    discountValue: document.getElementById('cup-value').value,
    quantity: document.getElementById('cup-qty').value || 1,
    sizeAllowed: document.getElementById('cup-size').value,
    expiresAt: document.getElementById('cup-expires').value,
    maxUses: document.getElementById('cup-max').value || null,
    maxUsesPerCpf: document.getElementById('cup-cpf').value || 1,
    totemIds,
  };
  const res = await fetch('/client/coupons/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const result = await res.json();
  if (result.error) {
    alert(result.error);
    return;
  }
  const toast = document.getElementById('coupon-toast');
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; location.reload(); }, 1500);
};

async function toggleCoupon(id) {
  await fetch('/client/coupons/toggle/' + id, { method: 'POST' });
  location.reload();
}
<\/script>`;
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
.fullscreen-btn{cursor:pointer;background:var(--accent-primary)!important;color:#fff!important;border:none!important;font-weight:600;transition:all .2s}
.fullscreen-btn:hover{background:var(--accent-secondary)!important;transform:translateY(-2px);box-shadow:0 4px 12px rgba(108,92,231,.4)}
body.fs-mode .main-header,body.fs-mode footer,body.fs-mode #js-status,body.fs-mode #debug-info,body.fs-mode #no-results{display:none!important}
body.fs-mode main{padding:0!important;max-width:none!important}
body.fs-mode .grid-view{gap:.8rem;padding:.8rem;max-width:none;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
body.fs-mode .totem-card{border-radius:8px}
body.fs-mode .totem-card:hover{transform:none}
.fs-exit-btn{display:none;position:fixed;top:12px;right:12px;z-index:9999;background:rgba(255,61,113,.9);color:#fff;border:none;border-radius:50px;padding:.5rem 1rem;font-size:.85rem;font-weight:600;cursor:pointer;backdrop-filter:blur(8px);box-shadow:0 4px 16px rgba(0,0,0,.4);transition:all .2s}
.fs-exit-btn:hover{background:rgba(255,61,113,1);transform:scale(1.05)}
body.fs-mode .fs-exit-btn{display:flex;align-items:center;gap:.4rem}
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
        <button class="status-pill fullscreen-btn" id="fullscreen-btn" title="Tela cheia - apenas totens"><i class="fas fa-expand"></i> Fullscreen</button>
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
<button class="fs-exit-btn" id="fs-exit-btn"><i class="fas fa-compress"></i> Sair do Fullscreen</button>
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
var OFFLINE_TIMEOUT = 90;
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

(function(){
  var fsBtn=document.getElementById('fullscreen-btn');
  var exitBtn=document.getElementById('fs-exit-btn');
  var isFS=false;
  function enterFS(){
    var el=document.documentElement;
    if(el.requestFullscreen)el.requestFullscreen();
    else if(el.webkitRequestFullscreen)el.webkitRequestFullscreen();
    document.body.classList.add('fs-mode');
    isFS=true;
    fsBtn.innerHTML='<i class="fas fa-compress"></i> Sair';
    try{localStorage.setItem('live_fullscreen','1');}catch(e){}
  }
  function exitFS(){
    if(document.exitFullscreen)document.exitFullscreen();
    else if(document.webkitExitFullscreen)document.webkitExitFullscreen();
    document.body.classList.remove('fs-mode');
    isFS=false;
    fsBtn.innerHTML='<i class="fas fa-expand"></i> Fullscreen';
    try{localStorage.removeItem('live_fullscreen');}catch(e){}
  }
  if(fsBtn) fsBtn.addEventListener('click',function(){isFS?exitFS():enterFS()});
  if(exitBtn) exitBtn.addEventListener('click',exitFS);
  document.addEventListener('fullscreenchange',function(){
    if(!document.fullscreenElement&&!document.webkitFullscreenElement){
      document.body.classList.remove('fs-mode');
      isFS=false;
      if(fsBtn) fsBtn.innerHTML='<i class="fas fa-expand"></i> Fullscreen';
    }
  });
  document.addEventListener('webkitfullscreenchange',function(){
    if(!document.fullscreenElement&&!document.webkitFullscreenElement){
      document.body.classList.remove('fs-mode');
      isFS=false;
      if(fsBtn) fsBtn.innerHTML='<i class="fas fa-expand"></i> Fullscreen';
    }
  });
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&isFS)exitFS()});
})();
<\/script>`;
}
