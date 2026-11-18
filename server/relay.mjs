// 轉送伺服器：同一個房間（網址路徑）的連線互相廣播訊息。
// 用法：npm run relay          （預設連接埠 8787）
//       PORT=9000 npm run relay
// 用戶端：new WebSocketTransport('ws://主機:8787/房間名稱')
import { WebSocketServer } from 'ws';

/**
 * 建立轉送伺服器。
 * @param {{ port?: number, maxMessageSize?: number, log?: boolean }} options
 */
export function createRelay({ port = 8787, maxMessageSize = 64 * 1024, log = true } = {}) {
  /** @type {Map<string, Set<import('ws').WebSocket>>} */
  const rooms = new Map();
  const wss = new WebSocketServer({ port, maxPayload: maxMessageSize });

  wss.on('connection', (socket, req) => {
    const room = decodeURIComponent((req.url ?? '/').split('?')[0]) || '/';
    let members = rooms.get(room);
    if (!members) rooms.set(room, (members = new Set()));
    members.add(socket);
    /** 這條連線的玩家編號（從第一個訊息的 f 欄位得知），斷線時代為通知其他人 */
    let peerId = null;
    if (log) console.log(`[relay] 加入 ${room}（${members.size} 人）`);

    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      if (peerId === null) {
        try {
          const f = JSON.parse(text).f;
          if (typeof f === 'string') peerId = f;
        } catch {}
      }
      for (const other of members) if (other !== socket && other.readyState === 1) other.send(text);
    });

    socket.on('close', () => {
      members.delete(socket);
      // 對方沒說再見就斷線（關掉分頁、網路中斷）：替他廣播離開
      if (peerId) {
        const leave = JSON.stringify({ t: '$leave', f: peerId });
        for (const other of members) if (other.readyState === 1) other.send(leave);
      }
      if (members.size === 0) rooms.delete(room);
      if (log) console.log(`[relay] 離開 ${room}（${members.size} 人）`);
    });
  });

  return {
    wss,
    rooms,
    ready: new Promise((resolve) => wss.once('listening', resolve)),
    get port() {
      const a = wss.address();
      return typeof a === 'object' && a ? a.port : port;
    },
    close: () =>
      new Promise((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close(() => resolve());
      }),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const relay = createRelay({ port: Number(process.env.PORT) || 8787 });
  await relay.ready;
  console.log(`[relay] 轉送伺服器啟動：ws://localhost:${relay.port}/<房間名稱>`);
}
