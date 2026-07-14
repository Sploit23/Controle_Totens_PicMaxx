const express = require('express');
const crypto = require('crypto');
const { getTotems,
        getUsers, getAllLicenses, createLicense, updateLicense,
        hashPassword, verifyPassword } = require('../database');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '123456';
const ADMIN_PASS_HASH = hashPassword(ADMIN_PASS);

function log(rid, msg, data) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = rid ? `[${ts}][${rid}]` : `[${ts}]`;
  if (data) console.log(`${prefix} ${msg}`, data);
  else console.log(`${prefix} ${msg}`);
}

function paymentLabel(method) {
  const labels = { pix: 'PIX', credit: 'Crédito', debit: 'Débito', test: 'Teste', money: 'Dinheiro', unknown: '—' };
  return labels[method] || method || '—';
}

const router = express.Router();
const sessions = new Map();

function auth(req, res, next) {
  const sid = req.cookies?.sid;
  if (sid && sessions.has(sid)) {
    req.session = sessions.get(sid);
    return next();
  }
  if (req.path === '/login') return next();
  res.redirect('/admin/login');
}

router.use(auth);

router.get('/login', (req, res) => {
  if (req.cookies?.sid && sessions.has(req.cookies.sid)) return res.redirect('/admin');
  res.send(loginPage());
});

router.post('/login', (req, res) => {
  const { user, pass } = req.body;
  if (user === ADMIN_USER && pass && verifyPassword(pass, ADMIN_PASS_HASH)) {
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { user, createdAt: Date.now() });
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax', maxAge: 86400000 });
    return res.redirect('/admin');
  }
  res.send(loginPage('Credenciais invalidas'));
});

router.get('/logout', (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) sessions.delete(sid);
  res.clearCookie('sid');
  res.redirect('/admin/login');
});

router.get('/', (req, res) => {
  const totems = getTotems();
  const users = getUsers();
  const licenses = getAllLicenses();
  const licenseCreated = req.query.license === 'created';
  res.send(dashboardPage({ totems, users, licenses, licenseCreated }));
});

router.post('/license/create', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).send('userId obrigatorio');
  const token = createLicense(parseInt(userId));
  log(null, `Licenca criada via admin: ${token} para usuario ${userId}`);
  res.redirect('/admin?license=created');
});

function loginPage(error) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Login - Controle Maxx</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: system-ui, -apple-system, sans-serif; background: linear-gradient(135deg, #0f0c29, #302b63, #24243e); min-height:100vh; display:flex; align-items:center; justify-content:center; }
.card { background:#fff; border-radius:20px; padding:50px 40px; width:100%; max-width:420px; box-shadow:0 25px 60px rgba(0,0,0,0.5); text-align:center; }
.logo { font-size:32px; font-weight:800; color:#302b63; margin-bottom:4px; letter-spacing:-1px; }
.logo span { color:#f5a623; }
.sub { color:#888; font-size:14px; margin-bottom:32px; }
.form-group { margin-bottom:20px; text-align:left; }
label { display:block; font-size:13px; font-weight:600; color:#444; margin-bottom:6px; }
input { width:100%; padding:14px 16px; border:2px solid #e0e0e0; border-radius:12px; font-size:15px; transition:border-color .2s; outline:none; }
input:focus { border-color:#302b63; }
.btn { width:100%; padding:14px; border:none; border-radius:12px; font-size:16px; font-weight:700; cursor:pointer; background:linear-gradient(135deg, #302b63, #24243e); color:#fff; transition:opacity .2s; margin-top:8px; }
.btn:hover { opacity:.9; }
.error { background:#fef2f2; color:#dc2626; padding:12px; border-radius:10px; font-size:14px; margin-bottom:20px; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">Controle <span>Maxx</span></div>
  <p class="sub">Painel administrativo</p>
  ${error ? `<div class="error">${error}</div>` : ''}
  <form method="POST">
    <div class="form-group"><label>Usuario</label><input name="user" autofocus></div>
    <div class="form-group"><label>Senha</label><input type="password" name="pass"></div>
    <button class="btn">Entrar</button>
  </form>
</div>
</body>
</html>`;
}

function dashboardPage(data) {
  const { totems, users, licenses } = data;
  const licenseCreated = data.licenseCreated || false;
  const licenseMsg = licenseCreated ? '<div class="msg-success">Licenca criada com sucesso!</div>' : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Controle Maxx — Admin</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: system-ui, -apple-system, sans-serif; background:#f0f2f5; color:#1a1a2e; }
.topbar { background:#fff; border-bottom:1px solid #e8e8e8; padding:16px 28px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100; }
.topbar-left { display:flex; align-items:center; gap:16px; }
.topbar h1 { font-size:20px; font-weight:800; letter-spacing:-.5px; }
.topbar h1 span { color:#f5a623; }
.topbar-right { display:flex; align-items:center; gap:12px; }
.btn-logout { padding:8px 18px; border:none; border-radius:10px; font-size:13px; font-weight:600; cursor:pointer; background:#fee2e2; color:#dc2626; transition:background .2s; text-decoration:none; }
.btn-logout:hover { background:#fecaca; }
.container { max-width:1400px; margin:0 auto; padding:24px 28px; }
.section { background:#fff; border-radius:16px; padding:24px; margin-bottom:24px; box-shadow:0 1px 4px rgba(0,0,0,.04); }
.section h2 { font-size:18px; font-weight:700; margin-bottom:16px; display:flex; align-items:center; gap:8px; }
.section h2 .count { font-size:13px; font-weight:400; color:#888; }
table { width:100%; border-collapse:collapse; }
th { text-align:left; padding:12px 14px; font-size:12px; font-weight:600; color:#888; text-transform:uppercase; letter-spacing:.3px; border-bottom:2px solid #f0f0f0; }
td { padding:12px 14px; font-size:14px; border-bottom:1px solid #f5f5f5; }
.cell-mono { font-family:'SF Mono','Fira Code',monospace; font-size:13px; }
.badge { display:inline-block; padding:3px 10px; border-radius:20px; font-size:12px; font-weight:600; }
.badge-ok { background:#ecfdf5; color:#059669; }
.badge-warn { background:#fef3c7; color:#d97706; }
.badge-fail { background:#fef2f2; color:#dc2626; }
.msg-success { background:#ecfdf5; color:#059669; padding:12px 16px; border-radius:10px; font-size:14px; font-weight:600; margin-bottom:16px; border-left:4px solid #059669; }
.btn { padding:10px 24px; border:none; border-radius:10px; font-size:14px; font-weight:600; cursor:pointer; transition:all .2s; }
.btn-primary { background:#302b63; color:#fff; }
.btn-primary:hover { background:#24243e; }
.empty { text-align:center; padding:40px; color:#999; font-size:14px; }
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-left">
    <h1>Controle <span>Maxx</span></h1>
  </div>
  <div class="topbar-right">
    <a href="/admin/logout" class="btn-logout">Sair</a>
  </div>
</div>

<div class="container">
  <div class="section">
    <h2>Clientes <span class="count">(${users.length})</span></h2>
    <table>
      <thead><tr><th>ID</th><th>Nome</th><th>Email</th><th>Plano</th><th>Status</th><th>Totens</th><th>Licenças</th><th>Desde</th></tr></thead>
      <tbody>${users.map(u => {
        const userTotens = totems.filter(t => t.user_id === u.id);
        const userLicenses = licenses.filter(l => l.user_id === u.id);
        return `<tr>
          <td class="cell-mono">#${u.id}</td>
          <td><strong>${u.name}</strong></td>
          <td class="cell-mono">${u.email}</td>
          <td><span class="badge badge-${u.plan === 'pro' ? 'ok' : 'warn'}">${u.plan}</span></td>
          <td><span class="badge ${u.active ? 'badge-ok' : 'badge-fail'}">${u.active ? 'Ativo' : 'Suspenso'}</span></td>
          <td>${userTotens.length} (${userTotens.map(t => t.id).join(', ')})</td>
          <td>${userLicenses.length} ativas</td>
          <td style="font-size:13px;color:#999">${u.created_at}</td>
        </tr>`;
      }).join('') || '<tr><td colspan="8" class="empty">Nenhum cliente</td></tr>'}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Licencas <span class="count">(${licenses.length})</span></h2>
    ${licenseMsg}
    <div style="display:flex;gap:20px;align-items:start;flex-wrap:wrap;">
      <div style="flex:1;min-width:300px;">
        <table>
          <thead><tr><th>Token</th><th>Cliente</th><th>Totem</th><th>Expira</th><th>Status</th></tr></thead>
          <tbody>${licenses.map(l => `<tr>
            <td class="cell-mono" style="font-size:11px">${l.token}</td>
            <td>${l.user_name || '#' + l.user_id}</td>
            <td>${l.totem_id || '—'}</td>
            <td style="font-size:13px;color:#999">${l.expires_at ? new Date(l.expires_at+'Z').toLocaleDateString('pt-BR') : '—'}</td>
            <td><span class="badge ${l.active ? 'badge-ok' : 'badge-fail'}">${l.active ? 'Ativa' : 'Inativa'}</span></td>
          </tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhuma licenca</td></tr>'}
          </tbody>
        </table>
      </div>
      <div style="min-width:220px;background:#f8f9fa;border-radius:14px;padding:20px;border:1px solid #eee;">
        <h3 style="font-size:15px;font-weight:700;margin-bottom:14px;">Criar Licenca</h3>
        <form method="POST" action="/admin/license/create">
          <div style="margin-bottom:12px;">
            <label style="display:block;font-size:11px;font-weight:600;color:#666;margin-bottom:3px;">Cliente</label>
            <select name="userId" style="padding:8px 12px;border:2px solid #e0e0e0;border-radius:8px;font-size:14px;width:100%;outline:none;">
              ${users.map(u => `<option value="${u.id}">${u.name} (${u.email})</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary" style="width:100%;">Gerar Licenca</button>
        </form>
      </div>
    </div>
  </div>

</div>
</body>
</html>`;
}

module.exports = router;
