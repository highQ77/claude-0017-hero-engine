/**
 * official-demo-007-network：多人連線。
 *
 * 所有人共用同一個 3D 廣場（同步實體是連線後才陸續建立的，所以不切換場景），四個分頁只換左邊的說明與操作：
 *   ① 連線（connect）：連線方式、自己、房主、玩家名單與延遲；加入／移除機器人玩家
 *   ② 訊息（messages）：表情（send 廣播）、請房主擲骰子（request／handle）
 *   ③ 同步（sync）：WASD 移動自己的角色，其他人的角色自動同步、插值；流量統計
 *   ④ 網路狀況（conditions）：模擬延遲（自己寫的傳輸）、斷線與自動重連、事件紀錄
 *
 * 連線用戶端與共用規則在 network.ts；機器人在 bots.ts；介面在 public/ui/scene.xml。
 * 開兩個分頁就是兩位真人玩家；跨電腦先 npm run relay，再用 ?net=ws://主機:8787/房間 開啟。
 */
import type { Entity } from '@engine/ecs';
import { Euler, Vector3 } from '@engine/math';
import { PluginManager } from '@engine/plugins';
import perfMonitor from '@engine/packages/perf-monitor';
import { MeshRenderer, OrbitControl, spawn } from '@engine/render';
import { Transform } from '@engine/scene';
import { Text3D } from '@engine/text3d';
import * as ui2d from '@engine/ui2d';
import type { UILabel } from '@engine/ui2d';
import { type Bot, createBot } from './bots';
import { audio, engine, input, net, ui, world } from './engine';
import {
  type PlayerMeta,
  type RollResult,
  client,
  delay,
  hostOf,
  installDiceRules,
  myMeta,
  nameOf,
  rollDice,
  transportName,
} from './network';

// ───────── 廣場 ─────────

spawn.defaultLights(world, { shadows: true });
spawn.mesh(world, {
  geometry: { circle: 9.5 },
  material: '#2c3328',
  rotation: [-Math.PI / 2, 0, 0],
  receiveShadow: true,
});
spawn.mesh(world, {
  geometry: { circle: [3, 6] },
  material: '#3a4232',
  rotation: [-Math.PI / 2, 0, 0],
  position: [0, 0.01, 0],
  receiveShadow: true,
});
// 噴水池
spawn.mesh(world, {
  geometry: { cylinder: [1.3, 0.5] },
  material: '#8a8f80',
  position: [0, 0.25, 0],
  castShadow: true,
  receiveShadow: true,
});
spawn.mesh(world, {
  geometry: { cylinder: [1.15, 0.05] },
  material: { standard: { color: '#4cc9f0', roughness: 0.1 } },
  position: [0, 0.48, 0],
});
spawn.mesh(world, { geometry: { cylinder: [0.2, 1.2] }, material: '#8a8f80', position: [0, 0.9, 0], castShadow: true });
// 路燈與樹
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  const [x, z] = [Math.cos(a) * 9, Math.sin(a) * 9];
  if (i % 2) {
    spawn.mesh(world, {
      geometry: { cylinder: [0.15, 1] },
      material: '#6b4a2b',
      position: [x, 0.5, z],
      castShadow: true,
    });
    spawn.mesh(world, { geometry: { cone: [0.9, 1.8] }, material: '#3f7a3a', position: [x, 1.8, z], castShadow: true });
  } else {
    spawn.mesh(world, {
      geometry: { cylinder: [0.06, 2.4] },
      material: '#3a3f36',
      position: [x, 1.2, z],
      castShadow: true,
    });
    spawn.mesh(world, {
      geometry: { sphere: 0.2 },
      material: { standard: { color: '#fff3c4', emissive: '#ffd166', emissiveIntensity: 1 } },
      position: [x, 2.5, z],
    });
  }
}
// 攝影機：左邊的說明面板會擋住畫面左側，所以整個往左移一點
const eye = new Vector3(-2, 12, 13);
const look = new Vector3(-2, 0, 0.5);
const cam = spawn.camera(world, { position: eye, target: look, fov: 50 });
world.add(cam, OrbitControl, { target: look, minDistance: 5, maxDistance: 30, wheelNeedsFocus: true });

// ───────── 角色（同步實體的預製物件）─────────

/** 每位玩家（peerId）的角色實體：表情要冒在誰的頭上 */
const avatars = new Map<string, Entity>();

// 預製物件：自己建立（local）和收到別人的（遠端複本）都會呼叫，建立外觀
net.registerPrefab('avatar', ({ world: w, entity, data, local, owner }) => {
  const { name, color } = data as { name: string; color: string };
  w.add(entity, MeshRenderer, {
    geometry: { capsule: [0.32, 0.6], offset: [0, 0.62, 0] },
    material: { standard: { color, roughness: 0.45 } },
    castShadow: true,
  });
  spawn.mesh(w, {
    geometry: { cone: [0.13, 0.3], rotation: [-Math.PI / 2, 0, 0] },
    material: '#ffffff',
    position: [0, 0.82, -0.34],
    parent: entity,
  });
  // 名牌：永遠面向攝影機的平面文字
  spawn.entity(
    w,
    { position: [0, 1.6, 0], parent: entity },
    Text3D.with({
      mode: 'flat',
      text: local ? `${name}（你）` : name,
      size: 0.26,
      billboard: true,
      anchorY: 'bottom',
      color: 0xffffff,
      background: 'rgba(10,14,22,0.7)',
      padding: 0.3,
    }),
  );
  // 自己的角色：腳下的綠圈
  if (local)
    spawn.mesh(w, {
      geometry: { torus: [0.55, 0.04] },
      material: { basic: { color: '#9acd32' } },
      rotation: [-Math.PI / 2, 0, 0],
      position: [0, 0.03, 0],
      parent: entity,
    });
  avatars.set(owner?.id ?? client.peerId, entity);
});

// ───────── 表情（send／on）─────────

const EMOTES = ['👋 哈囉', '😄 哈哈', '👍 讚', '❤️ 喜歡', '💤 好睏', '🎉 太棒了'];
const bubbles = new Map<Entity, Entity>();

/** 在角色頭上冒出一段文字，2.5 秒後消失 */
function showBubble(avatar: Entity | undefined, text: string): void {
  if (avatar === undefined || !world.isAlive(avatar)) return;
  const old = bubbles.get(avatar);
  if (old !== undefined && world.isAlive(old)) world.destroy(old);
  const bubble = spawn.entity(
    world,
    { position: [0, 2.2, 0], parent: avatar },
    Text3D.with({
      mode: 'flat',
      text,
      size: 0.38,
      billboard: true,
      anchorY: 'bottom',
      color: 0x222222,
      background: 'rgba(255,255,255,0.92)',
      padding: 0.35,
    }),
  );
  bubbles.set(avatar, bubble);
  engine.timers.after(2.5, () => world.destroy(bubble), { owner: bubble });
}

const chat: string[] = [];
function addChat(line: string): void {
  chat.unshift(line);
  chat.length = Math.min(chat.length, 8);
  ui.require<UILabel>('chatLog').setText(chat.join('\n'));
}

function sendEmote(i: number): void {
  const text = EMOTES[i];
  client.send('emote', { text }); // 廣播給房間裡的其他人（不會送給自己）
  showBubble(avatars.get(client.peerId), text);
  addChat(`${myMeta.name}：${text}`);
  audio.play('sounds/pop.wav', { volume: 0.4 });
}
client.on<{ text: string }>('emote', ({ text }, from) => {
  showBubble(avatars.get(from.id), text);
  addChat(`${from.meta.name}：${text}`);
});

// ───────── 擲骰子（request／handle）─────────

const showRoll = (r: RollResult) => {
  addChat(`🎲 ${r.who} 擲出 ${r.value}`);
  ui.toast(`${r.who} 擲出 ${r.value}`, { icon: 'star', color: '#ffd166' });
};
installDiceRules(client, showRoll);

// ───────── 自己的角色：WASD 移動 ─────────

let me: Entity | null = null;
const move = new Vector3();
const euler = new Euler();
engine.on('update', (time) => {
  EMOTES.forEach((_, i) => input.wasPressed(`Digit${i + 1}`) && sendEmote(i));
  if (me === null) return;
  move.set(
    (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0) -
      (input.isDown('KeyA') || input.isDown('ArrowLeft') ? 1 : 0),
    0,
    (input.isDown('KeyS') || input.isDown('ArrowDown') ? 1 : 0) -
      (input.isDown('KeyW') || input.isDown('ArrowUp') ? 1 : 0),
  );
  if (move.lengthSq() === 0) return;
  const t = world.require(me, Transform);
  move.normalize().multiplyScalar(4 * time.delta);
  t.position.add(move);
  // 留在廣場上、不走進噴水池
  const r = Math.hypot(t.position.x, t.position.z);
  if (r > 8.5) t.position.multiplyScalar(8.5 / r);
  if (r < 1.7 && r > 0) t.position.multiplyScalar(1.7 / r);
  t.rotation.setFromEuler(euler.set(0, Math.atan2(-move.x, -move.z), 0));
  // 位置不用自己送：NetworkPlugin 每秒送 sendRate 次自己的同步實體
});

// ───────── 連線狀態、玩家名單 ─────────

const STATUS: Record<string, string> = { connected: '已連線', connecting: '連線中…', disconnected: '離線' };
const events: string[] = [];
function addEvent(text: string): void {
  const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  events.unshift(`${time}　${text}`);
  events.length = Math.min(events.length, 8);
  ui.require<UILabel>('eventLog').setText(events.join('\n'));
}
client.onStatus((s) => {
  addEvent(`狀態：${STATUS[s] ?? s}`);
  ui.require<UILabel>('status').setText(STATUS[s] ?? s);
});
client.onPeerJoin((p) => {
  addEvent(`加入：${p.meta.name}`);
  ui.toast(`${p.meta.name} 加入了`, { icon: 'user', color: String(p.meta.color ?? '#9acd32') });
});
client.onPeerLeave((p) => addEvent(`離開：${p.meta.name}`));

ui.require<UILabel>('transport').setText(transportName);
ui.require<UILabel>('me').setText(`${myMeta.name}（編號 ${client.peerId.slice(0, 8)}）`);

/** 名單有變才重新產生列表（延遲取到 5 毫秒） */
let lastPeers = '';
function updatePeers(): void {
  const host = hostOf(client);
  const rows = [
    { id: client.peerId, meta: myMeta as PlayerMeta, rtt: null as number | null },
    ...[...client.peers.values()].map((p) => ({ id: p.id, meta: p.meta as PlayerMeta, rtt: p.rtt })),
  ].map((p) => ({
    name: `${p.meta.name}${p.id === client.peerId ? '（你）' : ''}${p.id === host ? ' 👑' : ''}`,
    color: p.meta.color,
    info: p.id === client.peerId ? '' : p.rtt === null ? '…' : `${Math.round(p.rtt / 5) * 5} ms`,
  }));
  const key = JSON.stringify(rows);
  if (key !== lastPeers) {
    lastPeers = key;
    ui.setItems('peers', rows);
  }
  const connected = client.status === 'connected';
  ui.require<UILabel>('host').setText(
    connected ? `${nameOf(client, host)}${host === client.peerId ? '（你）' : ''}` : '—',
  );
  ui.require<UILabel>('online').setText(connected ? `線上 ${client.peers.size + 1} 人` : STATUS[client.status]);
  const rtts = [...client.peers.values()].map((p) => p.rtt).filter((r): r is number => r !== null);
  ui.require<UILabel>('onlineSub').setText(
    connected
      ? `房主：${nameOf(client, host)}${rtts.length ? `　最大延遲 ${Math.round(Math.max(...rtts))} ms` : ''}`
      : ' ',
  );
}
engine.timers.every(0.5, updatePeers, { realtime: true });

// 流量：每秒算一次差值
let last = { ...client.stats };
engine.timers.every(
  1,
  () => {
    const s = client.stats;
    const kb = (n: number) => (n / 1024).toFixed(1);
    ui.require<UILabel>('remoteCount').setText(String(net.remoteCount));
    ui.require<UILabel>('sendRate').setText(`${s.messagesSent - last.messagesSent} 則`);
    ui.require<UILabel>('traffic').setText(
      `送出 ${kb(s.bytesSent - last.bytesSent)} KB/s　收到 ${kb(s.bytesReceived - last.bytesReceived)} KB/s（${s.messagesReceived - last.messagesReceived} 則）`,
    );
    last = { ...s };
  },
  { realtime: true },
);

// ───────── 機器人 ─────────

const bots: Bot[] = [];

ui.setHandlers({
  addBot: async () => {
    if (bots.length >= 6) return ui.toast('最多 6 個機器人', { icon: 'info' });
    bots.push(await createBot());
  },
  removeBot: () => bots.pop()?.stop(),
  emote1: () => sendEmote(0),
  emote2: () => sendEmote(1),
  emote3: () => sendEmote(2),
  emote4: () => sendEmote(3),
  emote5: () => sendEmote(4),
  emote6: () => sendEmote(5),
  roll: () => {
    rollDice(client, showRoll).catch(() => ui.toast('房主沒有回應', { icon: 'warning', color: '#ff6b6b' }));
  },
  delay: (e) => (delay.ms = Number(e.value)),
  disconnect: () => client.disconnect(),
  reconnect: () => {
    if (client.status === 'disconnected') client.connect().catch(() => {});
  },
});

// 效能監視器：按 ` 鍵顯示／隱藏
await new PluginManager(engine, { api: { ui2d } }).install(perfMonitor, {
  toggleKey: 'Backquote',
  visible: false,
  position: { bottom: 16, right: 16 },
});

engine.start();

// 連上之後才建立自己的角色（建立時會告訴房間裡的每個人）；之後加入的人會自動收到
client
  .connect()
  .then(() => {
    const a = Math.random() * Math.PI * 2;
    me = net.spawn(
      'avatar',
      { name: myMeta.name, color: myMeta.color },
      { position: new Vector3(Math.cos(a) * 4, 0, Math.sin(a) * 4) },
    );
    updatePeers();
  })
  .catch((error) => ui.toast(`連線失敗：${(error as Error).message}`, { icon: 'warning', color: '#ff6b6b' }));
// 一開始只有自己時，先放兩個機器人作伴（之後可以在「連線」分頁移除）
engine.timers.after(1.5, async () => {
  if (client.peers.size === 0) for (let i = 0; i < 2; i++) bots.push(await createBot());
});
// 關掉分頁時，機器人也一起離開
addEventListener('pagehide', () => {
  for (const b of bots) b.stop();
});
