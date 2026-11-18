/**
 * 多人連線的用戶端（engine.ts 用它建立 NetworkPlugin；其他玩家的方塊在 network.ts）。
 * - 預設：同一個瀏覽器的分頁互連（開兩個分頁就能看到對方）
 * - 跨電腦：先 npm run relay，再用 ?net=ws://主機:8787/房間 開啟
 */
import { Color } from '@engine/math';
import { BroadcastChannelTransport, NetworkClient, WebSocketTransport } from '@engine/network';

const netUrl = new URLSearchParams(location.search).get('net');

/** 自己的顏色（方塊的外框、頭像、其他人看到的方塊） */
export const myColor = `#${new Color().setHSL(Math.random(), 0.7, 0.62).getHexString()}`;

export const client = new NetworkClient({
  transport: netUrl ? new WebSocketTransport(netUrl) : new BroadcastChannelTransport('official-demo-000'),
  meta: { name: `玩家 ${Math.floor(Math.random() * 900 + 100)}`, color: myColor },
});
