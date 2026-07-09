const express = require('express');
const { registerTotem, createTransaction, createFailedTransaction, getAllPrices,
        getLicenseByToken, bindLicenseToTotem, bindTotemToUser, getUserById,
        getTotem, getDB,
        updateTotemConfig,
        saveTelemetry, saveScreenshot, getLatestTelemetry, getLatestScreenshot,
        getLatestTelemetryForTotems,
        getCouponUsageCount, getCouponUsageCountByCpf, getCouponTotemIds, useCoupon } = require('../database');

function log(rid, msg, data) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = rid ? `[${ts}][${rid}]` : `[${ts}]`;
  if (data) console.log(`${prefix} ${msg}`, data);
  else console.log(`${prefix} ${msg}`);
}

function getExtraConfig(totemId) {
  const db = getDB();
  let userId = null;
  const totem = db.prepare(`SELECT user_id FROM totems WHERE id = ?`).get(totemId);
  if (totem) userId = totem.user_id;

  const getVal = (key) => {
    const t = db.prepare(`SELECT value FROM config WHERE key = ?`).get(`totem_${totemId}_${key}`);
    if (t && t.value !== null && t.value !== '') return t.value;
    if (userId) {
      const u = db.prepare(`SELECT value FROM config WHERE key = ?`).get(`user_${userId}_${key}`);
      if (u && u.value !== null && u.value !== '') return u.value;
    }
    const g = db.prepare(`SELECT value FROM config WHERE key = ?`).get(key);
    if (g && g.value !== null && g.value !== '') return g.value;
    return null;
  };

  return {
    combo_enabled: getVal('combo_enabled') || '1',
    sizes_enabled: getVal('sizes_enabled') || 'both',
  };
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

    // Vincular licenca ao totem (se ainda nao tiver)
    if (!license.totem_id) bindLicenseToTotem(licenseToken, totemId);

    log(req.rid, `Totem ${totemId} vinculado ao usuario ${license.user_name || license.user_id} via licenca ${licenseToken}`);
  }

  registerTotem(totemId, name || totemId);

  // Vincular totem ao usuario dono da licenca (depois de registerTotem garantir que o registro existe)
  if (licenseToken) {
    const license = getLicenseByToken(licenseToken);
    if (license) bindTotemToUser(totemId, license.user_id);
  }

  // Armazenar config reportada pelo kiosk
  if (localConfig) {
    updateTotemConfig(totemId, JSON.stringify(localConfig));
  }

  const prices = getAllPrices(totemId);
  const extra = getExtraConfig(totemId);
  log(req.rid, `Totem registrado: ${totemId}`);
  res.json({ success: true, prices, combo_enabled: extra.combo_enabled, sizes_enabled: extra.sizes_enabled });
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
  const extra = getExtraConfig(req.params.totemId);
  res.json({ success: true, prices, combo_enabled: extra.combo_enabled, sizes_enabled: extra.sizes_enabled });
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

router.post('/telemetry', (req, res) => {
  try {
    const { totemId, cpu, ram, paper_10x15, paper_15x20, printer_error, printer_name, screenshot } = req.body;
    if (!totemId) return res.status(400).json({ success: false, error: 'totemId obrigatorio' });

    saveTelemetry(totemId, { cpu, ram, paper_10x15, paper_15x20, printer_error, printer_name });
    if (screenshot) saveScreenshot(totemId, screenshot);

    log(req.rid, `Telemetry: ${totemId} CPU:${cpu} RAM:${ram} Papel:${paper_10x15}/${paper_15x20}`);
    res.json({ success: true });
  } catch (e) {
    log(req.rid, `Erro telemetry: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/telemetry', (req, res) => {
  try {
    const { ids } = req.query;
    if (!ids) return res.json({ success: true, telemetry: {}, screenshots: {} });
    const totemIds = ids.split(',').map(s => s.trim()).filter(Boolean);
    const telemetry = getLatestTelemetryForTotems(totemIds);
    const screenshots = {};
    for (const id of totemIds) {
      const s = getLatestScreenshot(id);
      if (s) screenshots[id] = s.screenshot;
    }
    res.json({ success: true, telemetry, screenshots });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/telemetry/:totemId', (req, res) => {
  try {
    const telemetry = getLatestTelemetry(req.params.totemId);
    const screenshot = getLatestScreenshot(req.params.totemId);
    res.json({
      success: true,
      telemetry: telemetry || null,
      screenshot: screenshot?.screenshot || null,
      screenshot_updated: screenshot?.updated_at || null,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── COUPON VALIDATE ─────────────────────────────────────
router.post('/coupon/validate', (req, res) => {
  try {
    const { code, cpf, totemId } = req.body;
    if (!code) return res.json({ valid: false, error: 'Código do cupom obrigatório' });
    if (!cpf) return res.json({ valid: false, error: 'CPF obrigatório' });

    const db = getDB();
    const coupon = db.prepare(`SELECT * FROM coupons WHERE code = ?`).get(code.toUpperCase());
    if (!coupon) return res.json({ valid: false, error: 'Cupom não encontrado' });
    if (!coupon.active) return res.json({ valid: false, error: 'Cupom inativo' });

    // Verificar validade
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date())
      return res.json({ valid: false, error: 'Cupom expirado' });

    // Verificar limite total de usos
    if (coupon.max_uses) {
      const used = getCouponUsageCount(coupon.id);
      if (used >= coupon.max_uses)
        return res.json({ valid: false, error: 'Cupom esgotado' });
    }

    // Verificar limite por CPF
    const usedByCpf = getCouponUsageCountByCpf(coupon.id, cpf);
    if (usedByCpf >= (coupon.max_uses_per_cpf || 1))
      return res.json({ valid: false, error: 'CPF já atingiu o limite de usos deste cupom' });

    // Verificar se cupom é do dono do totem
    if (totemId) {
      const totem = db.prepare(`SELECT user_id FROM totems WHERE id = ?`).get(totemId);
      if (totem && totem.user_id !== coupon.user_id)
        return res.json({ valid: false, error: 'Cupom não disponível para este totem' });

      // Verificar restrição de totens específicos
      const restrictedTotems = getCouponTotemIds(coupon.id);
      if (restrictedTotems.length > 0 && !restrictedTotems.includes(totemId))
        return res.json({ valid: false, error: 'Cupom não disponível para este totem' });
    }

    log(req.rid, `Cupom validado: ${code} (CPF: ${cpf})`);
    res.json({
      valid: true,
      couponId: coupon.id,
      code: coupon.code,
      description: coupon.description,
      discountType: coupon.discount_type,
      discountValue: coupon.discount_value,
      sizeAllowed: coupon.size_allowed,
    });
  } catch (e) {
    log(req.rid, `Erro validar cupom: ${e.message}`);
    res.status(500).json({ valid: false, error: e.message });
  }
});

// ─── COUPON USE ─────────────────────────────────────────
router.post('/coupon/use', (req, res) => {
  try {
    const { couponId, cpf, totemId, transactionId, photoSize } = req.body;
    if (!couponId || !cpf) return res.status(400).json({ success: false, error: 'couponId e cpf obrigatórios' });

    const db = getDB();
    const coupon = db.prepare(`SELECT * FROM coupons WHERE id = ?`).get(couponId);
    if (!coupon) return res.status(404).json({ success: false, error: 'Cupom não encontrado' });
    if (!coupon.active) return res.json({ success: false, error: 'Cupom inativo' });

    useCoupon(couponId, cpf, totemId || null, transactionId || null, photoSize || null);
    log(req.rid, `Cupom usado: ${coupon.code} (CPF: ${cpf}, totem: ${totemId})`);
    res.json({ success: true });
  } catch (e) {
    log(req.rid, `Erro usar cupom: ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/ping', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

module.exports = router;
