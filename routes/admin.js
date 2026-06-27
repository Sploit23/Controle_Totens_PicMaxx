const express = require('express');
const crypto = require('crypto');
const { getStats, getTransactions, getTotems, getTotem, getAllPrices, setConfig, updateTotemName,
        getUsers, getAllLicenses } = require('../database');

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
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || '123456';
  if (user === adminUser && pass === adminPass) {
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
  const totemId = req.query.totem || null;
  const stats = getStats(totemId);
  const transactions = getTransactions(100, totemId);
  const totems = getTotems();
  const prices = getAllPrices(totemId);
  const selectedTotem = totemId ? getTotem(totemId) : null;
  const saved = req.query.saved === '1';
  const users = getUsers();
  const licenses = getAllLicenses();
  res.send(dashboardPage({ stats, transactions, totems, prices, selectedTotem, totemId, saved, users, licenses }));
});

router.post('/config', (req, res) => {
  const { totemId, config: cfg, key, value } = req.body;
  if (cfg && typeof cfg === 'object') {
    for (const [k, v] of Object.entries(cfg)) {
      if (v !== undefined && v !== '') setConfig(k, String(v), totemId || null);
    }
  } else if (key && value !== undefined) {
    setConfig(key, String(value), totemId || null);
  }
  const qs = totemId ? `?totem=${totemId}&saved=1` : '?saved=1';
  res.redirect(`/admin${qs}`);
});

router.post('/totem/rename', (req, res) => {
  const { totemId, name } = req.body;
  if (totemId && name) updateTotemName(totemId, name);
  res.redirect(`/admin?totem=${totemId}`);
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
  const { stats, transactions, totems, prices, selectedTotem, totemId, saved, users, licenses } = data;
  const savedMsg = saved ? '<div class="msg-success">Precos salvos com sucesso!</div>' : '';

  const totemOpts = totems.map(t =>
    `<option value="${t.id}" ${t.id === totemId ? 'selected' : ''}>${t.name || t.id}</option>`
  ).join('') + '<option value="">--- Todos ---</option>';

  const txRows = transactions.map(t => {
    let itemsHtml = '';
    try {
      const items = JSON.parse(t.items || '[]');
      if (items.length) itemsHtml = items.map(i => `${i.type || i.size || ''} x${i.qty || i.quantity || 1}`).join(', ');
    } catch {}
    return `<tr>
      <td class="cell-mono">#${t.id}</td>
      <td class="cell-mono">${t.code_id || '-'}</td>
      <td>${t.totem_id || '-'}</td>
      <td><strong>R$ ${parseFloat(t.total_value).toFixed(2)}</strong></td>
      <td><span class="badge ${t.payment_method === 'pix' ? 'badge-pix' : t.payment_method === 'test' ? 'badge-test' : 'badge-card'}">${paymentLabel(t.payment_method)}</span></td>
      <td><span class="badge ${t.status === 'completed' ? 'badge-ok' : t.status === 'failed' ? 'badge-fail' : 'badge-warn'}">${t.status === 'failed' ? 'Recusado' : t.status}</span></td>
      <td style="font-size:13px;color:#888">${itemsHtml}</td>
      <td class="cell-mono" style="font-size:11px;color:#999">${t.local_id || '-'}</td>
      <td style="font-size:13px;color:#999">${t.created_at?.replace('T', ' ').slice(0, 19) || t.created_at}</td>
    </tr>`;
  }).join('');

  const codeRows = (stats.recentCodes || []).map(c => `<tr>
    <td class="cell-mono"><strong>${c.id}</strong></td>
    <td>${c.totem_id || '-'}</td>
    <td>${c.photos}</td>
    <td>${c.used ? '<span class="badge badge-ok">Sim</span>' : '<span class="badge badge-warn">Nao</span>'}</td>
    <td style="font-size:13px;color:#999">${c.expires_at}</td>
    <td style="font-size:13px;color:#999">${c.created_at}</td>
  </tr>`).join('');

  const totemRows = totems.map(t => {
    const tp = getAllPrices(t.id);
    return `<tr>
      <td class="cell-mono">${t.id}</td>
      <td>
        <form method="POST" action="/admin/totem/rename" class="inline-form">
          <input name="totemId" value="${t.id}" hidden>
          <input name="name" value="${t.name || ''}" class="inline-input">
          <button class="btn-sm btn-ok">Salvar</button>
        </form>
      </td>
      <td style="font-size:13px;color:#888">${t.last_seen || 'Nunca'}</td>
      <td><a href="/admin?totem=${t.id}" class="link">Filtrar</a></td>
      <td style="font-size:12px;color:#999">R$ ${tp.preco_10x15} / R$ ${tp.preco_15x20}<br><span style="color:#bbb;font-size:11px">atacado ${tp.preco_10x15_bulk} (${tp.preco_10x15_threshold}+) | ${tp.preco_15x20_bulk} (${tp.preco_15x20_threshold}+)</span></td>
    </tr>`;
  }).join('');

  const selectedName = selectedTotem ? selectedTotem.name || selectedTotem.id : 'Global';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Controle Maxx${selectedTotem ? ' - ' + selectedName : ''}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: system-ui, -apple-system, sans-serif; background:#f0f2f5; color:#1a1a2e; }
.topbar { background:#fff; border-bottom:1px solid #e8e8e8; padding:16px 28px; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100; }
.topbar-left { display:flex; align-items:center; gap:16px; }
.topbar h1 { font-size:20px; font-weight:800; letter-spacing:-.5px; }
.topbar h1 span { color:#f5a623; }
.topbar select { padding:8px 12px; border:2px solid #e0e0e0; border-radius:10px; font-size:14px; background:#fff; cursor:pointer; outline:none; }
.topbar select:focus { border-color:#302b63; }
.topbar-right { display:flex; align-items:center; gap:12px; }
.badge-totem { background:#eef2ff; color:#4338ca; padding:4px 14px; border-radius:20px; font-size:13px; font-weight:600; }
.btn-logout { padding:8px 18px; border:none; border-radius:10px; font-size:13px; font-weight:600; cursor:pointer; background:#fee2e2; color:#dc2626; transition:background .2s; text-decoration:none; }
.btn-logout:hover { background:#fecaca; }
.container { max-width:1400px; margin:0 auto; padding:24px 28px; }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:16px; margin-bottom:28px; }
.card { background:#fff; border-radius:16px; padding:22px 24px; box-shadow:0 1px 4px rgba(0,0,0,.04); }
.card .label { font-size:13px; color:#888; font-weight:500; margin-bottom:6px; text-transform:uppercase; letter-spacing:.3px; }
.card .value { font-size:28px; font-weight:800; color:#1a1a2e; }
.card .subval { font-size:14px; color:#666; margin-top:2px; }
.card-gold { border-left:4px solid #f5a623; }
.card-purple { border-left:4px solid #302b63; }
.card-green { border-left:4px solid #059669; }
.card-blue { border-left:4px solid #2563eb; }
.card-red { border-left:4px solid #dc2626; }
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
.badge-pix { background:#e0f2fe; color:#0284c7; }
.badge-card { background:#f3e8ff; color:#7c3aed; }
.badge-test { background:#fef3c7; color:#d97706; }
.badge-fail { background:#fef2f2; color:#dc2626; }
.msg-success { background:#ecfdf5; color:#059669; padding:12px 16px; border-radius:10px; font-size:14px; font-weight:600; margin-bottom:16px; border-left:4px solid #059669; }
.pricing-grid { display:flex; gap:20px; align-items:start; flex-wrap:wrap; }
.pricing-card { background:#f8f9fa; border-radius:14px; padding:20px; min-width:220px; border:1px solid #eee; flex:1; }
.pricing-card h3 { font-size:15px; font-weight:700; margin:0 0 14px 0; color:#333; padding-bottom:10px; border-bottom:2px solid #e0e0e0; }
.pricing-item { margin-bottom:12px; }
.pricing-item label { display:block; font-size:11px; font-weight:600; color:#666; margin-bottom:3px; }
.pricing-item input { padding:8px 12px; border:2px solid #e0e0e0; border-radius:8px; font-size:14px; width:110px; outline:none; }
.pricing-item input:focus { border-color:#302b63; }
.btn { padding:10px 24px; border:none; border-radius:10px; font-size:14px; font-weight:600; cursor:pointer; transition:all .2s; }
.btn-primary { background:#302b63; color:#fff; }
.btn-primary:hover { background:#24243e; }
.btn-sm { padding:6px 14px; border:none; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; }
.btn-ok { background:#059669; color:#fff; }
.btn-ok:hover { background:#047857; }
.inline-form { display:flex; gap:6px; align-items:center; }
.inline-input { padding:6px 10px; border:2px solid #e0e0e0; border-radius:8px; font-size:13px; width:160px; outline:none; }
.inline-input:focus { border-color:#302b63; }
.link { color:#302b63; text-decoration:none; font-weight:600; font-size:13px; }
.link:hover { text-decoration:underline; }
.empty { text-align:center; padding:40px; color:#999; font-size:14px; }
</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-left">
    <h1>Controle <span>Maxx</span></h1>
    <form method="GET" action="/admin">
      <select name="totem" onchange="this.form.submit()">${totemOpts}</select>
    </form>
    ${selectedTotem ? `<span class="badge-totem">${selectedName}</span>` : ''}
  </div>
  <div class="topbar-right">
    <a href="/admin/logout" class="btn-logout">Sair</a>
  </div>
</div>

<div class="container">
  <div class="cards">
    <div class="card card-gold">
      <div class="label">Vendas</div>
      <div class="value">${stats.totalSales.count}</div>
      <div class="subval">R$ ${parseFloat(stats.totalSales.revenue).toFixed(2)}</div>
    </div>
    <div class="card card-green">
      <div class="label">Hoje</div>
      <div class="value">${stats.todaySales.count}</div>
      <div class="subval">R$ ${parseFloat(stats.todaySales.revenue).toFixed(2)}</div>
    </div>
    <div class="card card-purple">
      <div class="label">Codigos Ativos</div>
      <div class="value">${stats.activeCodes.count}</div>
    </div>
    <div class="card card-blue">
      <div class="label">Fotos</div>
      <div class="value">${stats.totalPhotos.count}</div>
    </div>
    <div class="card card-red">
      <div class="label">Recusadas</div>
      <div class="value">${stats.failedCount.count}</div>
      <div class="subval">${stats.testCount.count} teste (R$ ${parseFloat(stats.testCount.revenue).toFixed(2)})</div>
    </div>
  </div>

  <div class="section">
    <h2>Precos — ${selectedName}</h2>
    ${savedMsg}
    ${totemId ? `<div style="margin-bottom:14px"><a href="/admin" class="link" style="font-size:13px">← Usar precos globais</a></div>` : ''}
    <form method="POST" action="/admin/config">
      <input name="totemId" value="${totemId || ''}" hidden>
      <div class="pricing-grid">
        <div class="pricing-card">
          <h3>10x15</h3>
          <div class="pricing-item">
            <label>Preço unitário (R$)</label>
            <input name="config[preco_10x15]" value="${prices.preco_10x15}" step="0.5">
          </div>
          <div class="pricing-item">
            <label>Preço atacado (R$)</label>
            <input name="config[preco_10x15_bulk]" value="${prices.preco_10x15_bulk}" step="0.5">
          </div>
          <div class="pricing-item">
            <label>Qtd mínima para atacado</label>
            <input name="config[preco_10x15_threshold]" value="${prices.preco_10x15_threshold}" type="number" min="1">
          </div>
        </div>
        <div class="pricing-card">
          <h3>15x20</h3>
          <div class="pricing-item">
            <label>Preço unitário (R$)</label>
            <input name="config[preco_15x20]" value="${prices.preco_15x20}" step="0.5">
          </div>
          <div class="pricing-item">
            <label>Preço atacado (R$)</label>
            <input name="config[preco_15x20_bulk]" value="${prices.preco_15x20_bulk}" step="0.5">
          </div>
          <div class="pricing-item">
            <label>Qtd mínima para atacado</label>
            <input name="config[preco_15x20_threshold]" value="${prices.preco_15x20_threshold}" type="number" min="1">
          </div>
        </div>
      </div>
      <button class="btn btn-primary" style="margin-top:16px">Salvar Todos os Precos</button>
    </form>
  </div>

  <div class="section">
    <h2>Totens <span class="count">(${totems.length})</span></h2>
    <table>
      <thead><tr><th>ID</th><th>Nome</th><th>Ultimo Contato</th><th></th><th>Precos (10x15 / 15x20)</th></tr></thead>
      <tbody>${totemRows || '<tr><td colspan="5" class="empty">Nenhum totem registrado</td></tr>'}</tbody>
    </table>
  </div>

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
    <h2>Codigos Recentes <span class="count">(${(stats.recentCodes || []).length})</span></h2>
    <table>
      <thead><tr><th>Codigo</th><th>Totem</th><th>Fotos</th><th>Usado</th><th>Expira</th><th>Criado</th></tr></thead>
      <tbody>${codeRows || '<tr><td colspan="6" class="empty">Nenhum codigo</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Transacoes <span class="count">(${transactions.length})</span></h2>
    <table>
      <thead><tr><th>#</th><th>Codigo</th><th>Totem</th><th>Valor</th><th>Metodo</th><th>Status</th><th>Itens</th><th>ID Local</th><th>Data</th></tr></thead>
      <tbody>${txRows || '<tr><td colspan="9" class="empty">Nenhuma transacao</td></tr>'}</tbody>
    </table>
  </div>
</div>
</body>
</html>`;
}

module.exports = router;
