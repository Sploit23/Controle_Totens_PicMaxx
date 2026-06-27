require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const totemRoute = require('./routes/totem');
const adminRoute = require('./routes/admin');

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

app.get('/', (req, res) => res.redirect('/admin'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Controle Maxx] Rodando em http://0.0.0.0:${PORT}`);
  console.log(`[Controle Maxx] Admin: http://localhost:${PORT}/admin`);
});

module.exports = { log };
