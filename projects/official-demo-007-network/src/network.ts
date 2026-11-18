/**
 * 連線：用戶端、模擬延遲的傳輸、房主、擲骰子的規則（真人玩家和機器人共用）。
 *
 * - 預設：同一個瀏覽器的分頁互連（BroadcastChannel，不需要伺服器）。開兩個分頁就能看到對方
 * - 跨電腦：先 npm run relay，再用 ?net=ws://主機:8787/房間 開啟（機器人也會連到同一個房間）
 */
import { Color } from '@engine/math';
import {
  BroadcastChannelTransport,
  NetworkClient,
  type Transport,
  type TransportHandlers,
  WebSocketTransport,
} from '@engine/network';

const ROOM = 'official-demo-007-network';
const netUrl = new URLSearchParams(location.search).get('net');

/** 建立傳輸：有 ?net= 就連伺服器，否則同一個瀏覽器的分頁互連 */
export const createTransport = (): Transport =>
  netUrl ? new WebSocketTransport(netUrl) : new BroadcastChannelTransport(ROOM);

/** 現在用哪一種連線（顯示用） */
export const transportName = netUrl ? `WebSocket（${netUrl}）` : 'BroadcastChannel（同一個瀏覽器的分頁互連）';

/**
 * 模擬延遲：包住真正的傳輸，送出與收到的訊息都晚 delay.ms 毫秒才處理。
 * 自己寫傳輸方式只要實作 connect、send、close 三個方法。
 */
export const delay = { ms: 0 };
class DelayTransport implements Transport {
  constructor(private readonly inner: Transport) {}
  connect(handlers: TransportHandlers): void {
    this.inner.connect({
      ...handlers,
      message: (data) => (delay.ms > 0 ? setTimeout(() => handlers.message(data), delay.ms) : handlers.message(data)),
    });
  }
  send(data: string): void {
    if (delay.ms > 0) setTimeout(() => this.inner.send(data), delay.ms);
    else this.inner.send(data);
  }
  close(): void {
    this.inner.close();
  }
}

/** 玩家資料：名字與顏色（其他玩家在 peer.meta 拿到） */
export interface PlayerMeta {
  name: string;
  color: string;
  bot?: boolean;
  [key: string]: unknown;
}

const myColor = new Color().setHSL(Math.random(), 0.7, 0.6);
export const myMeta: PlayerMeta = {
  name: `玩家 ${Math.floor(Math.random() * 900 + 100)}`,
  color: `#${myColor.getHexString()}`,
};

/** 這個頁面的連線用戶端（engine.ts 用它建立 NetworkPlugin） */
export const client = new NetworkClient({
  transport: new DelayTransport(createTransport()),
  meta: myMeta,
  heartbeatInterval: 1000,
  reconnect: { minDelay: 500, maxDelay: 4000 },
});

/** 房主：編號最小的那一位（每個人都能自己算出同一個答案，不用另外選） */
export function hostOf(c: NetworkClient): string {
  return [c.peerId, ...c.peers.keys()].sort()[0];
}

/** 這位玩家的名字（自己或其他人） */
export function nameOf(c: NetworkClient, peerId: string): string {
  if (peerId === c.peerId) return String(c.meta.name);
  return String(c.peers.get(peerId)?.meta.name ?? peerId.slice(0, 6));
}

/** 擲骰子的結果（房主廣播給所有人） */
export interface RollResult {
  who: string;
  value: number;
}

/**
 * 擲骰子：請房主擲（請求與回應）。房主決定結果並廣播，大家看到的數字一樣，沒有人能作弊。
 * 每個用戶端（包括機器人）都要裝：自己變成房主時才會收到請求。
 */
export function installDiceRules(c: NetworkClient, onResult: (r: RollResult) => void): void {
  c.handle<null, number>('roll', (_data, from) => {
    const value = 1 + Math.floor(Math.random() * 6);
    const result: RollResult = { who: String(from.meta.name ?? from.id), value };
    c.send('rolled', result); // 告訴其他人
    onResult(result); // 房主自己也要顯示（send 不會送給自己）
    return value;
  });
  c.on<RollResult>('rolled', (r) => onResult(r));
}

/** 擲骰子：自己是房主就直接擲，否則請房主擲 */
export async function rollDice(c: NetworkClient, onResult: (r: RollResult) => void): Promise<number> {
  const host = hostOf(c);
  if (host === c.peerId) {
    const value = 1 + Math.floor(Math.random() * 6);
    const result: RollResult = { who: String(c.meta.name), value };
    c.send('rolled', result);
    onResult(result);
    return value;
  }
  return c.request<number>('roll', null, { to: host, timeout: 4000 });
}
