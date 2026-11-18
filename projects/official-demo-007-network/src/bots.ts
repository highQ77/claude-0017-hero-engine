/**
 * 機器人玩家：只開一個分頁也能看到多人連線的效果。
 *
 * 每個機器人是一個「沒有畫面的引擎」，有自己的 world、連線用戶端與同步外掛，
 * 和真人玩家一樣連到同一個房間：其他分頁、其他電腦也看得到它們。
 * （同一個分頁裡的 BroadcastChannel 物件之間也能互相收到訊息）
 */
import { Engine } from '@engine/core';
import { EcsPlugin } from '@engine/ecs';
import { Color, Euler, Vector3 } from '@engine/math';
import { NetworkClient, NetworkPlugin } from '@engine/network';
import { ScenePlugin, Transform } from '@engine/scene';
import { type PlayerMeta, createTransport, installDiceRules, rollDice } from './network';

const BOT_NAMES = ['小黃', '阿藍', '皮皮', '咪咪', '大熊', '跳跳', '豆豆', '球球'];
/** 機器人會說的話 */
const BOT_EMOTES = ['👋 哈囉', '😄 哈哈', '👍 讚', '💤 好睏', '🏃 跑起來'];
const BOT_REPLIES = ['👋 嗨！', '😄', '👍', '❤️'];

export interface Bot {
  readonly name: string;
  readonly client: NetworkClient;
  stop(): void;
}

let created = 0;

export async function createBot(): Promise<Bot> {
  const name = `🤖 ${BOT_NAMES[created++ % BOT_NAMES.length]}`;
  const color = `#${new Color().setHSL(Math.random(), 0.55, 0.55).getHexString()}`;
  const meta: PlayerMeta = { name, color, bot: true };

  // 沒有畫面的引擎：只有 ECS、場景（Transform）與同步外掛；分頁在背景也繼續跑
  const engine = new Engine({ pauseOnHidden: false });
  const ecs = new EcsPlugin();
  engine.use(ecs).use(new ScenePlugin());
  const client = new NetworkClient({ transport: createTransport(), meta, heartbeatInterval: 1000 });
  // 機器人自己不需要外觀：預製物件什麼都不做（其他玩家那邊會用自己的預製物件畫出來）
  const net = new NetworkPlugin(client, { sendRate: 20 }).registerPrefab('avatar', () => {});
  engine.use(net);
  installDiceRules(client, () => {});
  await client.connect();

  const start = new Vector3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10);
  const avatar = net.spawn('avatar', { name, color }, { position: start });
  const t = ecs.world.require(avatar, Transform);
  const target = start.clone();
  const step = new Vector3();
  const euler = new Euler();

  // 閒逛：走向隨機的點，到了停一下再選下一個點
  let pause = 0;
  engine.on('update', (time) => {
    if (pause > 0) {
      pause -= time.delta;
      return;
    }
    step.copy(target).sub(t.position).setY(0);
    const dist = step.length();
    if (dist < 0.1) {
      pause = 0.5 + Math.random() * 2;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 7;
      target.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      return;
    }
    step.multiplyScalar(Math.min(1, (2 * time.delta) / dist));
    t.position.add(step);
    t.rotation.setFromEuler(euler.set(0, Math.atan2(-step.x, -step.z), 0));
  });

  // 偶爾說句話、擲骰子；有人說話時有機會回應
  const say = (text: string) => client.send('emote', { text });
  engine.timers.every(7, () => {
    if (Math.random() < 0.5) say(BOT_EMOTES[Math.floor(Math.random() * BOT_EMOTES.length)]);
    else if (Math.random() < 0.3) rollDice(client, () => {}).catch(() => {});
  });
  client.on<{ text: string }>('emote', (_msg, from) => {
    if (from.meta.bot || Math.random() > 0.4) return; // 只回應真人玩家，而且不是每次都回
    engine.timers.after(0.6 + Math.random(), () => say(BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)]));
  });

  engine.start();
  return {
    name,
    client,
    stop() {
      client.disconnect(); // 其他玩家會收到離開的通知，移除它的角色
      engine.destroy();
    },
  };
}
