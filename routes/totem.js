const express = require('express');
const { registerTotem, createTransaction, createFailedTransaction, getAllPrices,
        getLicenseByToken, bindLicenseToTotem, bindTotemToUser, getUserById,
        updateTotemConfig } = require('../database');

function log(rid, msg, data) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = rid ? `[${ts}][${rid}]` : `[${ts}]`;
  if (data) console.log(`${prefix} ${msg}`, data);
  else console.log(`${prefix} ${msg}`);
}

const router = express.Router();

router.post('/register', (req, res) => {
  const { totemId, name, licenseToken, localConfig } = req.body;
  if (!totemId) return res.status(400).json({ success: false, error: 'totemId obrigatorio' });

  // Validar licenca se enviada
  if (licenseToken) {
    const license = getLicenseByToken(licenseToken);
    if (!license) return res.status(404).json({ success: false, error: 'Licenca invalida' });
    if (!license.active) return res.status(400).json({ success: false, error: 'Licenca inativa ou expirada' });
    if (license.totem_id && license.totem_id !== totemId)
      return res.status(400).json({ success: false, error: 'Licenca ja vinculada a outro totem' });

    // Vincular totem ao usuario dono da licenca
    bindTotemToUser(totemId, license.user_id);

    // Vincular licenca ao totem (se ainda nao tiver)
    if (!license.totem_id) bindLicenseToTotem(licenseToken, totemId);

    log(req.rid, `Totem ${totemId} vinculado ao usuario ${license.user_name || license.user_id} via licenca ${licenseToken}`);
  }

  registerTotem(totemId, name || totemId);

  // Armazenar config reportada pelo kiosk
  if (localConfig) {
    updateTotemConfig(totemId, JSON.stringify(localConfig));
  }

  const prices = getAllPrices(totemId);
  log(req.rid, `Totem registrado: ${totemId}`);
  res.json({ success: true, prices });
});

router.post('/check-license', (req, res) => {
  const { licenseToken } = req.body;
  if (!licenseToken) return res.json({ valid: false, connected: false, error: 'Token nao informado' });

  const license = getLicenseByToken(licenseToken);
  if (!license) return res.json({ valid: false, connected: false, error: 'Licenca invalida' });
  if (!license.active) return res.json({ valid: false, connected: false, error: 'Licenca inativa ou expirada' });

  const user = getUserById(license.user_id);
  if (!user) return res.json({ valid: false, connected: false, error: 'Usuario nao encontrado' });

  log(req.rid, `Licenca validada: ${licenseToken} — ${user.name} (${user.email})`);
  res.json({
    valid: true,
    connected: true,
    clientName: user.name,
    clientEmail: user.email,
    licenseToken: license.token,
    expiresAt: license.expires_at,
  });
});

router.get('/config/:totemId', (req, res) => {
  const prices = getAllPrices(req.params.totemId);
  res.json({ success: true, prices });
});

router.post('/confirm', (req, res) => {
  try {
    const { code, totalValue, items, payment_method, totemId, localId, isTest } = req.body;
    if (!code) return res.status(400).json({ success: false, error: 'Codigo obrigatorio' });

    const txId = createTransaction(code, totalValue || 0, items || [], totemId || null, payment_method || 'unknown', localId || null, isTest ? 1 : 0);
    log(req.rid, `Confirmado: ${code} (R$ ${totalValue}, ${payment_method})`);
    res.json({ success: true, transactionId: txId });
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
