const { WebSocketServer } = require('ws');

const totemConnections = new Map(); // totemId -> WebSocket

function initWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'register' && msg.totemId) {
          totemConnections.set(msg.totemId, ws);
          ws.send(JSON.stringify({ type: 'registered', totemId: msg.totemId }));
        }
      } catch {}
    });

    ws.on('close', () => {
      for (const [tid, conn] of totemConnections) {
        if (conn === ws) { totemConnections.delete(tid); break; }
      }
    });

    ws.on('error', () => {
      for (const [tid, conn] of totemConnections) {
        if (conn === ws) { totemConnections.delete(tid); break; }
      }
    });
  });
}

function notifyTotem(totemId, message) {
  const ws = totemConnections.get(totemId);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(message));
    return true;
  }
  return false;
}

function notifyUserTotems(userId, message) {
  const { getTotemsByUser } = require('./database');
  const totems = getTotemsByUser(userId);
  let count = 0;
  for (const t of totems) {
    if (notifyTotem(t.id, message)) count++;
  }
  return count;
}

module.exports = { initWebSocket, notifyTotem, notifyUserTotems, totemConnections };
