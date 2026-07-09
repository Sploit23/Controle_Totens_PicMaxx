const nodemailer = require('nodemailer');
const { getDB, getLatestTelemetry, getLastNotification, saveNotification } = require('./database');

const OFFLINE_TIMEOUT = 90 * 1000;

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function parseDbTime(str) {
  if (!str) return 0;
  return new Date(str + 'Z').getTime();
}

function isCooldownOk(lastDbRow, cooldownMs) {
  if (!lastDbRow) return true;
  return (Date.now() - parseDbTime(lastDbRow.sent_at)) > cooldownMs;
}

async function checkAndNotify() {
  const db = getDB();
  const cooldownMs = (parseInt(process.env.ALERT_COOLDOWN_MINUTES) || 30) * 60 * 1000;
  const paperThreshold = parseInt(process.env.PAPER_LOW_THRESHOLD) || 10;

  const totems = db.prepare('SELECT id, user_id FROM totems WHERE user_id IS NOT NULL').all();
  if (totems.length === 0) return;

  const transporter = createTransporter();
  if (!transporter) {
    console.warn('[Notification] SMTP nao configurado (falta SMTP_HOST/USER/PASS no .env)');
    return;
  }

  for (const totem of totems) {
    try {
      const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(totem.user_id);
      if (!user || !user.email) continue;

      const telemetry = getLatestTelemetry(totem.id);
      const telemetryTime = telemetry?.created_at ? parseDbTime(telemetry.created_at) : 0;
      const isOnline = telemetry && telemetryTime > 0 && (Date.now() - telemetryTime) < OFFLINE_TIMEOUT;

      const shouldSkip = {};
      const doNotify = async (type, subject, icon, color, body, value) => {
        if (shouldSkip[type]) return;
        const last = getLastNotification(totem.id, type);
        if (!isCooldownOk(last, cooldownMs)) return;
        const html = buildEmailHtml(icon, color, subject, totem, user, body);
        try {
          await transporter.sendMail({
            from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM}>`,
            to: user.email,
            subject: `[Maxx Print] ${subject} — ${totem.id}`,
            html,
          });
          saveNotification(totem.id, type, value || '');
          console.log(`[Notification] ${type} enviado para ${totem.id} -> ${user.email}`);
        } catch (mailErr) {
          console.error(`[Notification] Falha ao enviar email ${type} para ${totem.id}:`, mailErr.message);
        }
      };

      // --- OFFLINE ---
      if (!telemetry || !isOnline) {
        await doNotify(
          'offline', 'Totem Offline', '🔴', '#e74c3c',
          `O totem <strong>${totem.id}</strong> está offline desde ${telemetry?.created_at || 'nunca enviou telemetria'}.<br><br>Verifique a energia, internet e o funcionamento do software no totem.`
        );
        continue;
      }

      // --- BACK ONLINE (se estava offline antes e voltou) ---
      const lastOffline = getLastNotification(totem.id, 'offline');
      if (lastOffline) {
        const lastOnline = getLastNotification(totem.id, 'online');
        const hasOfflineSinceOnline = !lastOnline || parseDbTime(lastOffline.sent_at) > parseDbTime(lastOnline.sent_at);
        if (hasOfflineSinceOnline) {
          await doNotify(
            'online', 'Totem Online Novamente', '🟢', '#27ae60',
            `O totem <strong>${totem.id}</strong> voltou a ficar online.<br><br>Telemetria recebida em: ${telemetry.created_at}`
          );
        }
      }

      // --- LOW PAPER 10x15 ---
      const p10 = parseInt(telemetry.paper_10x15) || 0;
      if (p10 > 0 && p10 <= paperThreshold) {
        await doNotify(
          'low_paper_10x15', 'Papel 10×15 Baixo', '📋', '#f39c12',
          `O totem <strong>${totem.id}</strong> está com apenas <strong>${p10} folhas</strong> de papel 10×15 restantes.<br><br>Providencie a reposição em breve.`,
          String(p10)
        );
      }

      // --- LOW PAPER 15x20 ---
      const p20 = parseInt(telemetry.paper_15x20) || 0;
      if (p20 > 0 && p20 <= paperThreshold) {
        await doNotify(
          'low_paper_15x20', 'Papel 15×20 Baixo', '📋', '#f39c12',
          `O totem <strong>${totem.id}</strong> está com apenas <strong>${p20} folhas</strong> de papel 15×20 restantes.<br><br>Providencie a reposição em breve.`,
          String(p20)
        );
      }

      // --- PRINTER ERROR ---
      if (telemetry.printer_error && telemetry.printer_error.trim()) {
        const last = getLastNotification(totem.id, 'printer_error');
        const isDifferentError = !last || telemetry.printer_error !== last.alert_value;
        if (isDifferentError || isCooldownOk(last, cooldownMs)) {
          await doNotify(
            'printer_error', 'Erro na Impressora', '🖨️', '#e67e22',
            `O totem <strong>${totem.id}</strong> reportou erro na impressora:<br><br><code style="background:#fce4e4;padding:6px 10px;border-radius:4px;display:inline-block">${telemetry.printer_error}</code><br><br>Verifique o totem para resolver o problema.`,
            telemetry.printer_error
          );
        }
      }

    } catch (e) {
      console.error(`[Notification] Erro ao processar totem ${totem.id}:`, e.message);
    }
  }
}

function buildEmailHtml(icon, color, subject, totem, user, body) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:20px">
      <div style="text-align:center;padding:16px 0">
        <h1 style="margin:0;font-size:48px">${icon}</h1>
        <h2 style="color:${color};margin:8px 0 0">${subject}</h2>
      </div>
      <div style="background:#f8f9fa;border-radius:8px;padding:16px 20px;margin:16px 0">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:4px 0;font-size:14px;color:#555">Totem</td><td style="padding:4px 0;font-size:14px;font-weight:bold;text-align:right">${totem.id}</td></tr>
          <tr><td style="padding:4px 0;font-size:14px;color:#555">Cliente</td><td style="padding:4px 0;font-size:14px;font-weight:bold;text-align:right">${user.name}</td></tr>
          <tr><td style="padding:4px 0;font-size:14px;color:#555">Data/Hora</td><td style="padding:4px 0;font-size:14px;font-weight:bold;text-align:right">${new Date().toLocaleString('pt-BR')}</td></tr>
        </table>
      </div>
      <div style="padding:12px 0;line-height:1.6;font-size:15px;color:#333">
        ${body}
      </div>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#999;font-size:12px;text-align:center">
        Este é um envio automático do sistema de monitoramento Kiosk de Fotos / Maxx Print.<br>
        Não responda a este e-mail.
      </p>
    </div>
  `;
}

module.exports = { checkAndNotify };
