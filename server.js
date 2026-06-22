require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const uploadRoute = require('./routes/upload');
const totemRoute = require('./routes/totem');
const adminRoute = require('./routes/admin');
const uploadPageRoute = require('./routes/upload-page');
const { cleanupExpired } = require('./database');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api/upload', uploadRoute);
app.use('/api/totem', totemRoute);
app.use('/admin', adminRoute);
app.use('/upload', uploadPageRoute);

app.use('/uploads', express.static(path.resolve(process.env.UPLOAD_DIR || './uploads')));

app.get('/', (req, res) => res.redirect('/upload'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Controle Maxx] Rodando em http://0.0.0.0:${PORT}`);
  console.log(`[Controle Maxx] Admin: http://localhost:${PORT}/admin`);
});

setInterval(() => {
  const removed = cleanupExpired();
  if (removed > 0) console.log(`[Cleanup] ${removed} codigos expirados removidos`);
}, 5 * 60 * 1000);
