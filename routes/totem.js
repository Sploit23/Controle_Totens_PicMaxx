const express = require('express');
const { registerTotem, getCode, getPhotosByCode, createTransaction, getAllPrices, finalizeCode, updateCodeTotemId } = require('../database');
const { log } = require('../server');

const router = express.Router();

router.post('/register', (req, res) => {
  const { totemId, name } = req.body;
  if (!totemId) return res.status(400).json({ success: false, error: 'totemId obrigatorio' });
  registerTotem(totemId, name || totemId);
  const prices = getAllPrices(totemId);
  log(req.rid, `Totem registrado: ${totemId}`);
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

    if (new Date() > new Date(code.expires_at + 'Z')) return res.json({ success: false, error: 'Codigo expirado' });

    const photos = getPhotosByCode(code.id);
    const list = photos.map(p => ({
      id: p.id,
      filename: p.filename,
      originalName: p.original_name,
      size: p.size,
      url: `/uploads/${p.filename}`
    }));

    log(req.rid, `Fotos buscadas: ${code.id} (${list.length} fotos)`);
    res.json({ success: true, code: code.id, totemId: code.totem_id, photos: list, photoCount: list.length });
  } catch (e) {
    log(req.rid, `Erro ao buscar fotos: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/confirm', (req, res) => {
  try {
    const { code, totalValue, items, payment_method, totemId } = req.body;
    if (!code) return res.status(400).json({ success: false, error: 'Codigo obrigatorio' });

    const codeData = getCode(code);
    if (!codeData) return res.status(404).json({ success: false, error: 'Codigo invalido' });
    if (codeData.used) return res.status(400).json({ success: false, error: 'Codigo ja utilizado' });

    // Associar o codigo ao totem que esta imprimindo (se ainda não tiver)
    if (!codeData.totem_id && totemId) {
      updateCodeTotemId(code, totemId);
      codeData.totem_id = totemId;
    }

    const photosDeleted = finalizeCode(code);
    const txId = createTransaction(code, totalValue || 0, items || [], codeData.totem_id, payment_method || 'unknown');
    log(req.rid, `Confirmado: ${code} (R$ ${totalValue}, ${photosDeleted} fotos, ${payment_method})`);
    res.json({ success: true, transactionId: txId, photosDeleted });
  } catch (e) {
    log(req.rid, `Erro ao confirmar: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
