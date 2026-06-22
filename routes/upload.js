const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { createCode, addPhoto, getCode } = require('../database');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const router = express.Router();

router.post('/start', (req, res) => {
  const totemId = req.body.totemId || null;
  const code = createCode(totemId);
  res.json({
    success: true,
    code,
    expiresInMinutes: parseInt(process.env.CODE_EXPIRE_MINUTES || '60')
  });
});

router.post('/photos', upload.array('photos', 50), (req, res) => {
  try {
    const codeId = req.body.code;
    if (!codeId) return res.status(400).json({ success: false, error: 'Codigo obrigatorio' });

    const code = getCode(codeId);
    if (!code) return res.status(404).json({ success: false, error: 'Codigo invalido' });
    if (code.used) return res.status(400).json({ success: false, error: 'Codigo ja utilizado' });

    const now = new Date().toISOString();
    if (now > code.expires_at) return res.status(400).json({ success: false, error: 'Codigo expirado' });

    const files = req.files || [];
    for (const f of files) {
      addPhoto(codeId, f.filename, f.originalname, f.size);
    }

    res.json({ success: true, photos: files.length, code: codeId });
  } catch (e) {
    console.error('[Upload] Erro:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
