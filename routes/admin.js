const express = require('express');
const crypto = require('crypto');
const { getTotems, getUsers, getUserById, createUser, updateUser, deleteUser,
        getAllLicenses, createLicense, updateLicense, deleteLicense,
        getStats, hashPassword, verifyPassword } = require('../database');

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || '123456';
const ADMIN_PASS_HASH = hashPassword(ADMIN_PASS);

function log(rid, msg, data) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = rid ? `[${ts}][${rid}]` : `[${ts}]`;
  if (data) console.log(`${prefix} ${msg}`, data);
  else console.log(`${prefix} ${msg}`);
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

// ---- Auth ----
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

// ---- Dashboard ----
router.get('/', (req, res) => {
  const stats = getStats();
  const users = getUsers();
  const licenses = getAllLicenses();
  const totems = getTotems();
  const activeUsers = users.filter(u => u.active).length;
  const activeLicenses = licenses.filter(l => l.active).length;
  const totalRevenue = stats.totalSales.revenue || 0;
  const todayRevenue = stats.todaySales.revenue || 0;
  const todaySalesCount = stats.todaySales.count || 0;
  res.send(dashboardPage({ users, licenses, totems, activeUsers, activeLicenses, totalRevenue, todayRevenue, todaySalesCount, totalSalesCount: stats.totalSales.count || 0 }));
});

// ---- Clientes CRUD ----
router.get('/clientes', (req, res) => {
  const users = getUsers();
  const totems = getTotems();
  const licenses = getAllLicenses();
  res.send(clientesPage({ users, totems, licenses }));
});

router.post('/user/create', (req, res) => {
  const { name, email, password, plan } = req.body;
  if (!name || !email || !password) {
    return res.redirect('/admin/clientes?error=Campos+obrigatorios');
  }
  try {
    createUser(name, email, password, plan || 'basic');
    log(null, `Cliente criado via admin: ${email}`);
    res.redirect('/admin/clientes?success=Cliente+criado+com+sucesso');
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.redirect('/admin/clientes?error=Email+ja+cadastrado');
    }
    res.redirect('/admin/clientes?error=Erro+ao+criar+cliente');
  }
});

router.post('/user/:id/edit', (req, res) => {
  const id = parseInt(req.params.id);
  const { name, email, plan, password } = req.body;
  const fields = {};
  if (name) fields.name = name;
  if (email) fields.email = email;
  if (plan) fields.plan = plan;
  if (password && password.trim()) fields.password_hash = hashPassword(password);
  try {
    updateUser(id, fields);
    log(null, `Cliente #${id} atualizado via admin`);
    res.redirect('/admin/clientes?success=Cliente+atualizado+com+sucesso');
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.redirect('/admin/clientes?error=Email+ja+cadastrado');
    }
    res.redirect('/admin/clientes?error=Erro+ao+atualizar+cliente');
  }
});

router.post('/user/:id/delete', (req, res) => {
  const id = parseInt(req.params.id);
  deleteUser(id);
  log(null, `Cliente #${id} excluido via admin`);
  res.redirect('/admin/clientes?success=Cliente+excluido+com+sucesso');
});

router.post('/user/:id/toggle', (req, res) => {
  const id = parseInt(req.params.id);
  const user = getUserById(id);
  if (user) {
    updateUser(id, { active: user.active ? 0 : 1 });
    log(null, `Cliente #${id} ${user.active ? 'suspenso' : 'ativado'} via admin`);
  }
  res.redirect('/admin/clientes?success=Status+do+cliente+atualizado');
});

// ---- Licencas ----
router.get('/licencas', (req, res) => {
  const licenses = getAllLicenses();
  const users = getUsers();
  res.send(licencasPage({ licenses, users }));
});

router.post('/license/create', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.redirect('/admin/licencas?error=Selecione+um+cliente');
  const token = createLicense(parseInt(userId));
  log(null, `Licenca criada via admin: ${token} para usuario ${userId}`);
  res.redirect('/admin/licencas?success=Licenca+criada+com+sucesso');
});

router.post('/license/:id/toggle', (req, res) => {
  const id = parseInt(req.params.id);
  const licenses = getAllLicenses();
  const lic = licenses.find(l => l.id === id);
  if (lic) {
    updateLicense(id, { active: lic.active ? 0 : 1 });
    log(null, `Licenca #${id} ${lic.active ? 'desativada' : 'ativada'} via admin`);
  }
  res.redirect('/admin/licencas?success=Status+da+licenca+atualizado');
});

router.post('/license/:id/delete', (req, res) => {
  const id = parseInt(req.params.id);
  deleteLicense(id);
  log(null, `Licenca #${id} excluida via admin`);
  res.redirect('/admin/licencas?success=Licenca+excluida+com+sucesso');
});

// =============================================================================
// HTML PAGES
// =============================================================================

const CSS = `
:root {
  --bg: #f0f2f5; --bg-card: #ffffff; --bg-sidebar: #1a1a2e; --bg-sidebar-hover: #16213e;
  --bg-input: #f8f9fa; --border: #e2e8f0; --border-focus: #6366f1;
  --text: #1e293b; --text-secondary: #64748b; --text-sidebar: #cbd5e1; --text-sidebar-active: #ffffff;
  --primary: #6366f1; --primary-hover: #4f46e5; --primary-light: #eef2ff;
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
  --bg-input: #334155; --border: #334155; --border-focus: #818cf8;
  --text: #f1f5f9; --text-secondary: #94a3b8; --text-sidebar: #94a3b8; --text-sidebar-active: #ffffff;
  --primary-light: #1e1b4b; --success-light: #064e3b; --danger-light: #7f1d1d; --warning-light: #78350f;
  --shadow: 0 1px 3px rgba(0,0,0,.2); --shadow-lg: 0 10px 25px rgba(0,0,0,.3);
}
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background:var(--bg); color:var(--text); min-height:100vh; }
a { color:var(--primary); text-decoration:none; }
a:hover { text-decoration:underline; }

.sidebar {
  position:fixed; top:0; left:0; width:var(--sidebar-w); height:100vh; background:var(--bg-sidebar);
  padding:0; z-index:200; transition:transform .3s ease; display:flex; flex-direction:column;
  border-right:1px solid rgba(255,255,255,.06);
}
.sidebar-logo {
  padding:24px 20px 20px; font-size:22px; font-weight:800; color:#fff; letter-spacing:-.5px;
  border-bottom:1px solid rgba(255,255,255,.06);
}
.sidebar-logo span { color:#f5a623; }
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
  display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px;
}
.sidebar-footer .user-info { flex:1; }
.sidebar-footer .user-info .name { color:#fff; font-size:13px; font-weight:600; }
.sidebar-footer .user-info .role { color:var(--text-sidebar); font-size:11px; }

.main { margin-left:var(--sidebar-w); min-height:100vh; transition:margin .3s ease; }
.topbar {
  background:var(--bg-card); border-bottom:1px solid var(--border); padding:0 28px; height:64px;
  display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; z-index:100;
}
.topbar-title { font-size:18px; font-weight:700; }
.topbar-actions { display:flex; align-items:center; gap:12px; }
.hamburger {
  display:none; background:none; border:none; font-size:24px; cursor:pointer; color:var(--text);
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
  display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:28px;
}
.stat-card {
  background:var(--bg-card); border-radius:var(--radius-lg); padding:20px 24px;
  box-shadow:var(--shadow); border:1px solid var(--border); transition:var(--transition);
}
.stat-card:hover { box-shadow:var(--shadow-lg); transform:translateY(-1px); }
.stat-card .stat-icon {
  width:44px; height:44px; border-radius:12px; display:flex; align-items:center;
  justify-content:center; font-size:20px; margin-bottom:12px;
}
.stat-card .stat-value { font-size:28px; font-weight:800; letter-spacing:-1px; margin-bottom:2px; }
.stat-card .stat-label { font-size:13px; color:var(--text-secondary); font-weight:500; }
.stat-icon.blue { background:#eef2ff; color:#6366f1; }
.stat-icon.green { background:#ecfdf5; color:#10b981; }
.stat-icon.orange { background:#fff7ed; color:#f97316; }
.stat-icon.purple { background:#faf5ff; color:#a855f7; }
[data-theme="dark"] .stat-icon.blue { background:#1e1b4b; }
[data-theme="dark"] .stat-icon.green { background:#064e3b; }
[data-theme="dark"] .stat-icon.orange { background:#78350f; }
[data-theme="dark"] .stat-icon.purple { background:#581c87; }

.section {
  background:var(--bg-card); border-radius:var(--radius-lg); padding:24px;
  margin-bottom:24px; box-shadow:var(--shadow); border:1px solid var(--border);
}
.section-header {
  display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;
}
.section-header h2 { font-size:18px; font-weight:700; display:flex; align-items:center; gap:8px; }
.section-header .count { font-size:13px; font-weight:400; color:var(--text-secondary); }

.table-wrap { overflow-x:auto; -webkit-overflow-scrolling:touch; }
table { width:100%; border-collapse:collapse; min-width:600px; }
th {
  text-align:left; padding:12px 14px; font-size:12px; font-weight:600; color:var(--text-secondary);
  text-transform:uppercase; letter-spacing:.3px; border-bottom:2px solid var(--border);
  white-space:nowrap;
}
td { padding:12px 14px; font-size:14px; border-bottom:1px solid var(--border); vertical-align:middle; }
.cell-mono { font-family:'SF Mono','Fira Code',monospace; font-size:13px; }

.badge {
  display:inline-block; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:600; white-space:nowrap;
}
.badge-ok { background:var(--success-light); color:var(--success); }
.badge-warn { background:var(--warning-light); color:var(--warning); }
.badge-fail { background:var(--danger-light); color:var(--danger); }
.badge-info { background:var(--primary-light); color:var(--primary); }

.btn {
  padding:10px 20px; border:none; border-radius:10px; font-size:13px; font-weight:600;
  cursor:pointer; transition:var(--transition); display:inline-flex; align-items:center; gap:6px;
  white-space:nowrap;
}
.btn-primary { background:var(--primary); color:#fff; }
.btn-primary:hover { background:var(--primary-hover); }
.btn-success { background:var(--success); color:#fff; }
.btn-success:hover { background:#059669; }
.btn-danger { background:var(--danger); color:#fff; }
.btn-danger:hover { background:var(--danger-hover); }
.btn-outline {
  background:transparent; border:1px solid var(--border); color:var(--text-secondary);
}
.btn-outline:hover { border-color:var(--primary); color:var(--primary); background:var(--primary-light); }
.btn-sm { padding:6px 12px; font-size:12px; border-radius:8px; }
.btn-icon {
  width:34px; height:34px; padding:0; display:inline-flex; align-items:center; justify-content:center;
  border-radius:8px; border:1px solid var(--border); background:var(--bg-card); color:var(--text-secondary);
  cursor:pointer; transition:var(--transition); font-size:14px;
}
.btn-icon:hover { border-color:var(--primary); color:var(--primary); background:var(--primary-light); }
.btn-icon.danger:hover { border-color:var(--danger); color:var(--danger); background:var(--danger-light); }

.actions-cell { display:flex; gap:6px; flex-wrap:nowrap; }

.form-group { margin-bottom:16px; }
.form-group label { display:block; font-size:13px; font-weight:600; color:var(--text-secondary); margin-bottom:6px; }
.form-input {
  width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:10px;
  font-size:14px; background:var(--bg-input); color:var(--text); transition:var(--transition);
  outline:none;
}
.form-input:focus { border-color:var(--border-focus); box-shadow:0 0 0 3px rgba(99,102,241,.15); }
select.form-input { cursor:pointer; }

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
}
.toast.show { transform:translateY(0); opacity:1; }
.toast.success { background:var(--success); color:#fff; }
.toast.error { background:var(--danger); color:#fff; }

.empty { text-align:center; padding:48px 20px; color:var(--text-secondary); font-size:14px; }
.empty .empty-icon { font-size:40px; margin-bottom:12px; opacity:.5; }

.search-box {
  position:relative; max-width:320px;
}
.search-box input {
  width:100%; padding:10px 14px 10px 38px; border:1px solid var(--border); border-radius:10px;
  font-size:14px; background:var(--bg-input); color:var(--text); outline:none; transition:var(--transition);
}
.search-box input:focus { border-color:var(--border-focus); box-shadow:0 0 0 3px rgba(99,102,241,.15); }
.search-box .search-icon {
  position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-secondary); font-size:14px;
}

@media (max-width:768px) {
  .sidebar { transform:translateX(-100%); }
  .sidebar.open { transform:translateX(0); }
  .main { margin-left:0; }
  .hamburger { display:block; }
  .content { padding:16px; }
  .stats-grid { grid-template-columns:1fr 1fr; gap:10px; }
  .stat-card { padding:16px; }
  .stat-card .stat-value { font-size:22px; }
  .section { padding:16px; }
  .section-header { flex-direction:column; align-items:flex-start; }
  .topbar { padding:0 16px; }
  .modal { max-width:100%; margin:10px; }
  table { min-width:500px; }
}
@media (max-width:480px) {
  .stats-grid { grid-template-columns:1fr; }
  .actions-cell { flex-wrap:wrap; }
}
`;

function getThemeScript() {
  return `<script>
(function(){
  window.toggleTheme = function(){
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch(e) {}
  };
  window.closeSidebar = function(){
    const sb = document.getElementById('sidebar');
    if(sb) sb.classList.remove('open');
    document.body.classList.remove('sidebar-open');
  };
  window.openSidebar = function(){
    const sb = document.getElementById('sidebar');
    if(sb) sb.classList.add('open');
    document.body.classList.add('sidebar-open');
  };
  window.toggleSidebar = function(){
    const sb = document.getElementById('sidebar');
    if(!sb) return;
    if(sb.classList.contains('open')) window.closeSidebar();
    else window.openSidebar();
  };
  window.showToast = function(msg, type){
    const t = document.getElementById('toast');
    if(!t) return;
    t.textContent = msg;
    t.className = 'toast ' + (type||'success') + ' show';
    setTimeout(function(){ t.className = 'toast'; }, 3000);
  };
  window.openModal = function(id){ document.getElementById(id).classList.add('active'); };
  window.closeModal = function(id){ document.getElementById(id).classList.remove('active'); };
  window.closeAllModals = function(){ document.querySelectorAll('.modal-overlay').forEach(function(m){m.classList.remove('active');}); };
  window.filterTable = function(inputId, tableId){
    const q = document.getElementById(inputId).value.toLowerCase();
    const rows = document.querySelectorAll('#'+tableId+' tbody tr');
    rows.forEach(function(r){
      r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  };
  var hamburger = document.getElementById('hamburger-btn');
  if(hamburger) hamburger.addEventListener('click', function(){ toggleSidebar(); });
  var themeBtn = document.getElementById('theme-btn');
  if(themeBtn) themeBtn.addEventListener('click', function(){ toggleTheme(); });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') closeSidebar();
  });
  document.querySelectorAll('.modal-overlay').forEach(function(el){
    el.addEventListener('click',function(e){ if(e.target===el) el.classList.remove('active'); });
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

function sidebarHTML(active) {
  const nav = [
    { href: '/admin', icon: '&#9632;', label: 'Dashboard', id: 'dashboard' },
    { href: '/admin/clientes', icon: '&#9787;', label: 'Clientes', id: 'clientes' },
    { href: '/admin/licencas', icon: '&#9830;', label: 'Licencas', id: 'licencas' },
  ];
  return `
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-logo">Controle <span>Maxx</span></div>
    <nav class="sidebar-nav">
      ${nav.map(n => `<a href="${n.href}" class="${active===n.id?'active':''}"><span class="icon">${n.icon}</span>${n.label}</a>`).join('')}
    </nav>
    <div class="sidebar-footer">
      <div class="avatar">A</div>
      <div class="user-info">
        <div class="name">Admin</div>
        <div class="role">Administrador</div>
      </div>
    </div>
  </aside>`;
}

function topbarHTML(title) {
  return `
  <header class="topbar">
    <div style="display:flex;align-items:center;gap:12px;">
      <button class="hamburger" id="hamburger-btn">&#9776;</button>
      <span class="topbar-title">${title}</span>
    </div>
    <div class="topbar-actions">
      <button class="btn-theme" id="theme-btn" title="Alternar tema">&#9789;</button>
      <a href="/admin/logout" class="btn-logout">Sair</a>
    </div>
  </header>`;
}

function loginPage(error) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>Login - Controle Maxx</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:'Inter',system-ui,sans-serif; background:linear-gradient(135deg,#0f0c29,#302b63,#24243e); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:20px; }
.card { background:#fff; border-radius:20px; padding:48px 36px; width:100%; max-width:400px; box-shadow:0 25px 60px rgba(0,0,0,.5); text-align:center; }
.logo { font-size:30px; font-weight:800; color:#302b63; margin-bottom:4px; letter-spacing:-1px; }
.logo span { color:#f5a623; }
.sub { color:#888; font-size:14px; margin-bottom:32px; }
.form-group { margin-bottom:18px; text-align:left; }
label { display:block; font-size:13px; font-weight:600; color:#444; margin-bottom:6px; }
input { width:100%; padding:13px 16px; border:2px solid #e0e0e0; border-radius:12px; font-size:15px; transition:border-color .2s; outline:none; font-family:inherit; }
input:focus { border-color:#6366f1; }
.btn { width:100%; padding:14px; border:none; border-radius:12px; font-size:16px; font-weight:700; cursor:pointer; background:linear-gradient(135deg,#6366f1,#4f46e5); color:#fff; transition:opacity .2s; margin-top:8px; font-family:inherit; }
.btn:hover { opacity:.9; }
.error { background:#fef2f2; color:#dc2626; padding:12px; border-radius:10px; font-size:14px; margin-bottom:20px; font-weight:500; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">Controle <span>Maxx</span></div>
  <p class="sub">Painel administrativo</p>
  ${error ? `<div class="error">${error}</div>` : ''}
  <form method="POST">
    <div class="form-group"><label>Usuario</label><input name="user" autofocus required></div>
    <div class="form-group"><label>Senha</label><input type="password" name="pass" required></div>
    <button class="btn">Entrar</button>
  </form>
</div>
</body>
</html>`;
}

function dashboardPage(data) {
  const { users, licenses, totems, activeUsers, activeLicenses, totalRevenue, todayRevenue, todaySalesCount, totalSalesCount } = data;
  const recentLicenses = licenses.slice(0, 5);
  const onlineTotems = totems.filter(t => {
    if (!t.last_seen) return false;
    const diff = (Date.now() - new Date(t.last_seen+'Z').getTime()) / 1000;
    return diff < 180;
  });

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>Dashboard - Controle Maxx</title>
<style>${CSS}</style>
<script>try{document.documentElement.setAttribute('data-theme',localStorage.getItem('theme')||'light')}catch(e){}</script>
</head>
<body>
${sidebarHTML('dashboard')}
<div class="main">
  ${topbarHTML('Dashboard')}
  <div class="content">
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon blue">&#9787;</div>
        <div class="stat-value">${users.length}</div>
        <div class="stat-label">Clientes totais</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green">&#10003;</div>
        <div class="stat-value">${activeUsers}</div>
        <div class="stat-label">Clientes ativos</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon purple">&#9830;</div>
        <div class="stat-value">${activeLicenses}</div>
        <div class="stat-label">Licencas ativas</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon orange">&#9881;</div>
        <div class="stat-value">${onlineTotems.length}</div>
        <div class="stat-label">Totens online</div>
      </div>
    </div>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon green">&#36;</div>
        <div class="stat-value">R$ ${totalRevenue.toFixed(2)}</div>
        <div class="stat-label">Faturamento total</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon blue">&#9733;</div>
        <div class="stat-value">R$ ${todayRevenue.toFixed(2)}</div>
        <div class="stat-label">Faturamento hoje</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon orange">&#9884;</div>
        <div class="stat-value">${totalSalesCount}</div>
        <div class="stat-label">Vendas totais</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon purple">&#9884;</div>
        <div class="stat-value">${todaySalesCount}</div>
        <div class="stat-label">Vendas hoje</div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <h2>Licencas recentes</h2>
        <a href="/admin/licencas" class="btn btn-outline btn-sm">Ver todas</a>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Token</th><th>Cliente</th><th>Totem</th><th>Expira</th><th>Status</th></tr></thead>
          <tbody>${recentLicenses.map(l => `<tr>
            <td class="cell-mono" style="font-size:12px">${l.token}</td>
            <td>${l.user_name || '#' + l.user_id}</td>
            <td>${l.totem_id || '<span style="color:var(--text-secondary)">—</span>'}</td>
            <td style="font-size:13px;color:var(--text-secondary)">${l.expires_at ? new Date(l.expires_at+'Z').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}</td>
            <td><span class="badge ${l.active ? 'badge-ok' : 'badge-fail'}">${l.active ? 'Ativa' : 'Inativa'}</span></td>
          </tr>`).join('') || '<tr><td colspan="5" class="empty"><div class="empty-icon">&#9830;</div>Nenhuma licenca</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>
<div id="toast" class="toast"></div>
${getThemeScript()}
</body>
</html>`;
}

function clientesPage(data) {
  const { users, totems, licenses } = data;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>Clientes - Controle Maxx</title>
<style>${CSS}</style>
<script>try{document.documentElement.setAttribute('data-theme',localStorage.getItem('theme')||'light')}catch(e){}</script>
</head>
<body>
${sidebarHTML('clientes')}
<div class="main">
  ${topbarHTML('Clientes')}
  <div class="content">
    <div class="section">
      <div class="section-header">
        <h2>Todos os clientes <span class="count">(${users.length})</span></h2>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <div class="search-box">
            <span class="search-icon">&#128269;</span>
            <input type="text" id="searchClientes" placeholder="Buscar cliente..." oninput="filterTable('searchClientes','tableClientes')">
          </div>
          <button class="btn btn-primary" onclick="openModal('modalCreate')">&#43; Novo Cliente</button>
        </div>
      </div>
      <div class="table-wrap">
        <table id="tableClientes">
          <thead><tr><th>ID</th><th>Nome</th><th>Email</th><th>Plano</th><th>Status</th><th>Totens</th><th>Licencas</th><th>Desde</th><th>Acoes</th></tr></thead>
          <tbody>${users.map(u => {
            const userTotens = totems.filter(t => t.user_id === u.id);
            const userLicenses = licenses.filter(l => l.user_id === u.id);
            return `<tr>
              <td class="cell-mono">#${u.id}</td>
              <td><strong>${u.name}</strong></td>
              <td class="cell-mono">${u.email}</td>
              <td><span class="badge badge-${u.plan === 'pro' ? 'ok' : u.plan === 'enterprise' ? 'info' : 'warn'}">${u.plan}</span></td>
              <td><span class="badge ${u.active ? 'badge-ok' : 'badge-fail'}">${u.active ? 'Ativo' : 'Suspenso'}</span></td>
              <td>${userTotens.length > 0 ? userTotens.map(t => `<span class="badge badge-info" style="margin:1px">${t.id}</span>`).join('') : '<span style="color:var(--text-secondary)">Nenhum</span>'}</td>
              <td>${userLicenses.length}</td>
              <td style="font-size:13px;color:var(--text-secondary)">${u.created_at ? new Date(u.created_at+'Z').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}</td>
              <td>
                <div class="actions-cell">
                  <button class="btn-icon" title="Editar" onclick="openEditModal(${u.id},'${encodeURIComponent(u.name)}','${encodeURIComponent(u.email)}','${u.plan}')">&#9998;</button>
                  <form method="POST" action="/admin/user/${u.id}/toggle" style="display:inline">
                    <button class="btn-icon" title="${u.active ? 'Suspender' : 'Ativar'}" style="color:${u.active ? 'var(--warning)' : 'var(--success)'}" >${u.active ? '&#9209;' : '&#9650;'}</button>
                  </form>
                  <button class="btn-icon danger" title="Excluir" onclick="confirmDelete(${u.id},'${encodeURIComponent(u.name)}','user')">&#128465;</button>
                </div>
              </td>
            </tr>`;
          }).join('') || '<tr><td colspan="9" class="empty"><div class="empty-icon">&#9787;</div>Nenhum cliente cadastrado</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<!-- Modal: Novo Cliente -->
<div class="modal-overlay" id="modalCreate">
  <div class="modal">
    <h3>Novo Cliente</h3>
    <form method="POST" action="/admin/user/create">
      <div class="form-group"><label>Nome completo</label><input class="form-input" name="name" required placeholder="Ex: Joao Silva"></div>
      <div class="form-group"><label>Email</label><input class="form-input" type="email" name="email" required placeholder="email@exemplo.com"></div>
      <div class="form-group"><label>Senha</label><input class="form-input" type="password" name="password" required minlength="6" placeholder="Minimo 6 caracteres"></div>
      <div class="form-group">
        <label>Plano</label>
        <select class="form-input" name="plan">
          <option value="basic">Basic</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal('modalCreate')">Cancelar</button>
        <button type="submit" class="btn btn-primary">Criar Cliente</button>
      </div>
    </form>
  </div>
</div>

<!-- Modal: Editar Cliente -->
<div class="modal-overlay" id="modalEdit">
  <div class="modal">
    <h3>Editar Cliente</h3>
    <form method="POST" id="editForm">
      <div class="form-group"><label>Nome completo</label><input class="form-input" name="name" id="editName" required></div>
      <div class="form-group"><label>Email</label><input class="form-input" type="email" name="email" id="editEmail" required></div>
      <div class="form-group"><label>Nova senha (deixe vazio para manter)</label><input class="form-input" type="password" name="password" placeholder="Deixe vazio para nao alterar"></div>
      <div class="form-group">
        <label>Plano</label>
        <select class="form-input" name="plan" id="editPlan">
          <option value="basic">Basic</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal('modalEdit')">Cancelar</button>
        <button type="submit" class="btn btn-primary">Salvar Alteracoes</button>
      </div>
    </form>
  </div>
</div>

<!-- Modal: Confirmar exclusao -->
<div class="modal-overlay" id="modalDelete">
  <div class="modal">
    <h3>Confirmar exclusao</h3>
    <p style="margin-bottom:8px;color:var(--text-secondary)">Tem certeza que deseja excluir este item?</p>
    <p style="font-weight:700;margin-bottom:4px" id="deleteItemName"></p>
    <p style="font-size:13px;color:var(--danger);font-weight:500">Esta acao nao pode ser desfeita. Todas as licencas e vinculos serao removidos.</p>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal('modalDelete')">Cancelar</button>
      <form method="POST" id="deleteForm">
        <button type="submit" class="btn btn-danger">Excluir</button>
      </form>
    </div>
  </div>
</div>

<div id="toast" class="toast"></div>
${getThemeScript()}
<script>
window.openEditModal = function(id, name, email, plan){
  document.getElementById('editForm').action = '/admin/user/'+id+'/edit';
  document.getElementById('editName').value = decodeURIComponent(name);
  document.getElementById('editEmail').value = decodeURIComponent(email);
  document.getElementById('editPlan').value = plan;
  openModal('modalEdit');
};
window.confirmDelete = function(id, name, type){
  document.getElementById('deleteItemName').textContent = decodeURIComponent(name);
  document.getElementById('deleteForm').action = '/admin/user/'+id+'/delete';
  openModal('modalDelete');
};
</script>
</body>
</html>`;
}

function licencasPage(data) {
  const { licenses, users } = data;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<title>Licencas - Controle Maxx</title>
<style>${CSS}</style>
<script>try{document.documentElement.setAttribute('data-theme',localStorage.getItem('theme')||'light')}catch(e){}</script>
</head>
<body>
${sidebarHTML('licencas')}
<div class="main">
  ${topbarHTML('Licencas')}
  <div class="content">
    <div class="section">
      <div class="section-header">
        <h2>Todas as licencas <span class="count">(${licenses.length})</span></h2>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <div class="search-box">
            <span class="search-icon">&#128269;</span>
            <input type="text" id="searchLicencas" placeholder="Buscar licenca..." oninput="filterTable('searchLicencas','tableLicencas')">
          </div>
          <button class="btn btn-primary" onclick="openModal('modalCreateLic')">&#43; Nova Licenca</button>
        </div>
      </div>
      <div class="table-wrap">
        <table id="tableLicencas">
          <thead><tr><th>ID</th><th>Token</th><th>Cliente</th><th>Totem</th><th>Expira</th><th>Criada em</th><th>Status</th><th>Acoes</th></tr></thead>
          <tbody>${licenses.map(l => `<tr>
            <td class="cell-mono">#${l.id}</td>
            <td class="cell-mono" style="font-size:12px">${l.token}</td>
            <td>${l.user_name || '#' + l.user_id}</td>
            <td>${l.totem_id ? `<span class="badge badge-info">${l.totem_id}</span>` : '<span style="color:var(--text-secondary)">—</span>'}</td>
            <td style="font-size:13px;color:var(--text-secondary)">${l.expires_at ? new Date(l.expires_at+'Z').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}</td>
            <td style="font-size:13px;color:var(--text-secondary)">${l.created_at ? new Date(l.created_at+'Z').toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}</td>
            <td><span class="badge ${l.active ? 'badge-ok' : 'badge-fail'}">${l.active ? 'Ativa' : 'Inativa'}</span></td>
            <td>
              <div class="actions-cell">
                <form method="POST" action="/admin/license/${l.id}/toggle" style="display:inline">
                  <button class="btn-icon" title="${l.active ? 'Desativar' : 'Ativar'}" style="color:${l.active ? 'var(--warning)' : 'var(--success)'}">${l.active ? '&#9209;' : '&#9650;'}</button>
                </form>
                <button class="btn-icon danger" title="Excluir" onclick="confirmDeleteLic(${l.id},'${l.token}')">&#128465;</button>
              </div>
            </td>
          </tr>`).join('') || '<tr><td colspan="8" class="empty"><div class="empty-icon">&#9830;</div>Nenhuma licenca cadastrada</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>

<!-- Modal: Nova Licenca -->
<div class="modal-overlay" id="modalCreateLic">
  <div class="modal">
    <h3>Nova Licenca</h3>
    <form method="POST" action="/admin/license/create">
      <div class="form-group">
        <label>Cliente</label>
        <select class="form-input" name="userId" required>
          ${users.map(u => `<option value="${u.id}">${u.name} (${u.email})</option>`).join('')}
        </select>
      </div>
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;">Uma nova licenca sera gerada com validade de 1 ano.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal('modalCreateLic')">Cancelar</button>
        <button type="submit" class="btn btn-primary">Gerar Licenca</button>
      </div>
    </form>
  </div>
</div>

<!-- Modal: Confirmar exclusao licenca -->
<div class="modal-overlay" id="modalDeleteLic">
  <div class="modal">
    <h3>Confirmar exclusao</h3>
    <p style="margin-bottom:8px;color:var(--text-secondary)">Tem certeza que deseja excluir esta licenca?</p>
    <p style="font-family:monospace;font-weight:700;margin-bottom:4px" id="deleteLicToken"></p>
    <p style="font-size:13px;color:var(--danger);font-weight:500">Esta acao nao pode ser desfeita.</p>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal('modalDeleteLic')">Cancelar</button>
      <form method="POST" id="deleteLicForm">
        <button type="submit" class="btn btn-danger">Excluir</button>
      </form>
    </div>
  </div>
</div>

<div id="toast" class="toast"></div>
${getThemeScript()}
<script>
window.confirmDeleteLic = function(id, token){
  document.getElementById('deleteLicToken').textContent = token;
  document.getElementById('deleteLicForm').action = '/admin/license/'+id+'/delete';
  openModal('modalDeleteLic');
};
</script>
</body>
</html>`;
}

module.exports = router;
