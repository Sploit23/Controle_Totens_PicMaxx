const express = require('express');
const { registerTotem, getCode, getPhotosByCode, createTransaction, createFailedTransaction, getAllPrices, finalizeCode, updateCodeTotemId } = require('../database');

function log(rid, msg, data) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = rid ? `[${ts}][${rid}]` : `[${ts}]`;
  if (data) console.log(`${prefix} ${msg}`, data);
  else console.log(`${prefix} ${msg}`);
}

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
    const { code, totalValue, items, payment_method, totemId, localId, isTest } = req.body;
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
    const txId = createTransaction(code, totalValue || 0, items || [], codeData.totem_id, payment_method || 'unknown', localId || null, isTest ? 1 : 0);
    log(req.rid, `Confirmado: ${code} (R$ ${totalValue}, ${photosDeleted} fotos, ${payment_method})`);
    res.json({ success: true, transactionId: txId, photosDeleted });
  } catch (e) {
    log(req.rid, `Erro ao confirmar: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/transaction-failed', (req, res) => {
  try {
    const { code, totalValue, items, payment_method, totemId, error_reason, localId, isTest } = req.body;
    if (!code && !localId) return res.status(400).json({ success: false, error: 'code ou localId obrigatorio' });

    const txId = createFailedTransaction(code || null, totalValue || 0, items || [], totemId || null, payment_method || 'unknown', error_reason || '', localId || null, isTest ? 1 : 0);
    log(req.rid, `Transacao falhou: ${localId || code} (${payment_method}, motivo: ${error_reason || 'N/A'})`);
    res.json({ success: true, transactionId: txId });
  } catch (e) {
    log(req.rid, `Erro ao registrar falha: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
