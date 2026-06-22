const express = require('express');
const { getStats, getTransactions, getTotems, getConfig, setConfig, getAllPrices, updateTotemName } = require('../database');

const router = express.Router();

function auth(req, res, next) {
  const user = process.env.ADMIN_USER || 'admin';
  const pass = process.env.ADMIN_PASS || '123456';
  const b64 = (req.headers.authorization || '').replace('Basic ', '');
  const decoded = Buffer.from(b64, 'base64').toString();
  const [u, p] = decoded.split(':');
  if (u === user && p === pass) return next();
  res.set('WWW-Authenticate', 'Basic realm="Controle Maxx"');
  res.status(401).send('Acesso negado');
}

router.use(auth);

router.get('/', (req, res) => {
  const totemId = req.query.totem || null;
  const stats = getStats(totemId);
  const transactions = getTransactions(100, totemId);
  const totems = getTotems();
  const prices = getAllPrices(totemId);
  const selectedTotem = totemId ? require('../database').getTotem(totemId) : null;

  res.send(renderHtml({ stats, transactions, totems, prices, selectedTotem, totemId }));
});

router.post('/config', (req, res) => {
  const { key, value, totemId } = req.body;
  if (key && value !== undefined) setConfig(key, value, totemId || null);
  const query = totemId ? `?totem=${totemId}` : '';
  res.redirect(`/admin${query}`);
});

router.post('/totem/rename', (req, res) => {
  const { totemId, name } = req.body;
  if (totemId && name) updateTotemName(totemId, name);
  res.redirect(`/admin?totem=${totemId}`);
});

function renderHtml(data) {
  const { stats, transactions, totems, prices, selectedTotem, totemId } = data;

  const totemOptions = totems.map(t => `
    <option value="${t.id}" ${t.id === totemId ? 'selected' : ''}>${t.name || t.id}</option>
  `).join('') + '<option value="">--- Global ---</option>';

  const txRows = transactions.map(t => `
    <tr><td>${t.id}</td><td>${t.code_id}</td><td>${t.totem_id || '-'}</td><td>R$ ${parseFloat(t.total_value).toFixed(2)}</td><td>${t.status}</td><td>${t.created_at}</td></tr>
  `).join('');

  const codeRows = (stats.recentCodes || []).map(c => `
    <tr><td>${c.id}</td><td>${c.totem_id || '-'}</td><td>${c.photos}</td><td>${c.used ? 'Sim' : 'Nao'}</td><td>${c.expires_at}</td><td>${c.created_at}</td></tr>
  `).join('');

  const totemRows = totems.map(t => `
    <tr>
      <td>${t.id}</td>
      <td>
        <form method="POST" action="/admin/totem/rename" style="display:flex;gap:5px;">
          <input name="totemId" value="${t.id}" hidden>
          <input name="name" value="${t.name || ''}" style="padding:4px;border:1px solid #ddd;border-radius:3px;">
          <button type="submit" style="padding:4px 10px;background:#28a745;color:#fff;border:none;border-radius:3px;cursor:pointer;">OK</button>
        </form>
      </td>
      <td>${t.last_seen || 'Nunca'}</td>
      <td>${t.created_at}</td>
      <td><a href="/admin?totem=${t.id}">Filtrar</a></td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Controle Maxx${selectedTotem ? ' - ' + selectedTotem.name : ''}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: system-ui, sans-serif; background:#f5f5f5; padding:20px; }
    h1 { margin-bottom:10px; }
    .header { display:flex; align-items:center; gap:15px; margin-bottom:20px; flex-wrap:wrap; }
    .header select { padding:8px; border:1px solid #ddd; border-radius:4px; }
    .header a { color:#007bff; text-decoration:none; }
    .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:15px; margin-bottom:30px; }
    .card { background:#fff; border-radius:8px; padding:20px; box-shadow:0 1px 3px rgba(0,0,0,0.1); }
    .card h3 { font-size:14px; color:#666; margin-bottom:8px; }
    .card .value { font-size:26px; font-weight:700; }
    h2 { margin:25px 0 10px; }
    table { width:100%; border-collapse:collapse; background:#fff; border-radius:8px; overflow:hidden; margin-bottom:30px; box-shadow:0 1px 3px rgba(0,0,0,0.08); }
    th, td { padding:10px 12px; text-align:left; border-bottom:1px solid #eee; font-size:14px; }
    th { background:#fafafa; font-weight:600; }
    .config-box { background:#fff; border-radius:8px; padding:20px; margin-bottom:30px; box-shadow:0 1px 3px rgba(0,0,0,0.08); }
    .config-box form { display:flex; gap:15px; align-items:end; flex-wrap:wrap; }
    .config-box label { display:block; margin-bottom:4px; font-weight:600; font-size:14px; }
    .config-box input { padding:8px; border:1px solid #ddd; border-radius:4px; width:120px; }
    .config-box button { padding:8px 20px; background:#007bff; color:#fff; border:none; border-radius:4px; cursor:pointer; }
    .badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:12px; background:#e7f3ff; color:#0066cc; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Controle Maxx</h1>
    <form method="GET" action="/admin">
      <select name="totem" onchange="this.form.submit()">
        <option value="">--- Todos os totens ---</option>
        ${totemOptions}
      </select>
    </form>
    ${selectedTotem ? '<span class="badge">' + selectedTotem.name + '</span>' : ''}
  </div>

  <div class="cards">
    <div class="card"><h3>Vendas</h3><div class="value">${stats.totalSales.count}</div></div>
    <div class="card"><h3>Receita</h3><div class="value">R$ ${parseFloat(stats.totalSales.revenue).toFixed(2)}</div></div>
    <div class="card"><h3>Hoje</h3><div class="value">${stats.todaySales.count} / R$ ${parseFloat(stats.todaySales.revenue).toFixed(2)}</div></div>
    <div class="card"><h3>Codigos Ativos</h3><div class="value">${stats.activeCodes.count}</div></div>
    <div class="card"><h3>Fotos</h3><div class="value">${stats.totalPhotos.count}</div></div>
  </div>

  <h2>Precos ${selectedTotem ? '- ' + selectedTotem.name : '(Global)'}</h2>
  <div class="config-box">
    <form method="POST" action="/admin/config">
      <input name="totemId" value="${totemId || ''}" hidden>
      <div><label>10x15 (R$)</label><input name="key" value="preco_10x15" hidden><input name="value" value="${prices.preco_10x15}" step="0.5"></div>
      <div><label>15x20 (R$)</label><input name="key" value="preco_15x20" hidden><input name="value" value="${prices.preco_15x20}" step="0.5"></div>
      <button type="submit">Salvar</button>
      ${totemId ? '<a href="/admin" style="font-size:13px;color:#666;">Usar preco global</a>' : ''}
    </form>
  </div>

  <h2>Totens</h2>
  <table><thead><tr><th>ID</th><th>Nome</th><th>Ultimo contato</th><th>Criado</th><th></th></tr></thead><tbody>${totemRows}</tbody></table>

  <h2>Codigos Recentes</h2>
  <table><thead><tr><th>Codigo</th><th>Totem</th><th>Fotos</th><th>Usado</th><th>Expira</th><th>Criado</th></tr></thead><tbody>${codeRows}</tbody></table>

  <h2>Transacoes</h2>
  <table><thead><tr><th>#</th><th>Codigo</th><th>Totem</th><th>Valor</th><th>Status</th><th>Data</th></tr></thead><tbody>${txRows}</tbody></table>
</body>
</html>`;
}

module.exports = router;
