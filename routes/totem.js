const express = require('express');
const { registerTotem, getCode, getPhotosByCode, useCode, createTransaction, getAllPrices } = require('../database');

const router = express.Router();

router.post('/register', (req, res) => {
  const { totemId, name } = req.body;
  if (!totemId) return res.status(400).json({ success: false, error: 'totemId obrigatorio' });
  registerTotem(totemId, name || totemId);
  const prices = getAllPrices(totemId);
  res.json({ success: true, prices });
});

router.get('/config/:totemId', (req, res) => {
  const prices = getAllPrices(req.params.totemId);
  res.json({ success: true, prices });
});

router.get('/photos/:code', (req, res) => {
  try {
    const code = getCode(req.params.code);
    if (!code) return res.json({ success: false, error: 'Codigo invalido' });

    const now = new Date().toISOString();
    if (now > code.expires_at) return res.json({ success: false, error: 'Codigo expirado' });

    const photos = getPhotosByCode(code.id);
    const list = photos.map(p => ({
      id: p.id,
      filename: p.filename,
      originalName: p.original_name,
      size: p.size,
      url: `/uploads/${p.filename}`
    }));

    res.json({ success: true, code: code.id, totemId: code.totem_id, photos: list, photoCount: list.length });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/confirm', (req, res) => {
  try {
    const { code, totemId, totalValue, items } = req.body;
    if (!code) return res.status(400).json({ success: false, error: 'Codigo obrigatorio' });

    const codeData = getCode(code);
    if (!codeData) return res.status(404).json({ success: false, error: 'Codigo invalido' });
    if (codeData.used) return res.status(400).json({ success: false, error: 'Codigo ja utilizado' });

    useCode(code);
    const txId = createTransaction(code, totalValue || 0, items || [], codeData.totem_id || totemId);
    res.json({ success: true, transactionId: txId });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
