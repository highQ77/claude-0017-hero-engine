import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Vector3 } from 'three';
import { Engine } from '../src/core';
import { EcsPlugin, define } from '../src/ecs';
import { ScenePlugin, Transform } from '../src/scene';
import {
  LoopbackHub,
  NetworkClient,
  NetworkIdentity,
  NetworkPlugin,
  WebSocketTransport,
  type Peer,
} from '../src/network';
import { fakeScheduler } from './helpers';

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

describe('NetworkClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function pair(options: Partial<ConstructorParameters<typeof NetworkClient>[0]> = {}) {
    const hub = new LoopbackHub();
    const a = new NetworkClient({
      transport: hub.create(),
      peerId: 'A',
      meta: { name: '甲' },
      now: () => Date.now(),
      ...options,
    });
    const b = new NetworkClient({
      transport: hub.create(),
      peerId: 'B',
      meta: { name: '乙' },
      now: () => Date.now(),
      ...options,
    });
    await Promise.all([a.connect(), b.connect()]);
    await tick();
    return { hub, a, b };
  }

  test('連線後互相認識（含對方的資料）、收發訊息', async () => {
    const { a, b } = await pair();
    expect(a.peers.get('B')?.meta).toEqual({ name: '乙' });
    expect(b.peers.get('A')?.meta).toEqual({ name: '甲' });

    const got: [unknown, string][] = [];
    b.on('chat', (d, from) => got.push([d, from.id]));
    a.send('chat', { text: '嗨' });
    await tick();
    expect(got).toEqual([[{ text: '嗨' }, 'A']]);
    expect(a.stats.messagesSent).toBeGreaterThan(0);
    expect(b.stats.bytesReceived).toBeGreaterThan(0);
    expect(() => a.send('$join')).toThrow(/保留/);
  });

  test('先收到一般訊息、才收到對方的自我介紹：onPeerJoin 仍然拿得到對方的資料', async () => {
    // 加入一個已經有人在送訊息（例如同步位置）的房間、或斷線重連時：
    // 對方的一般訊息會比他回覆的 hello 先到
    const hub = new LoopbackHub();
    const a = new NetworkClient({ transport: hub.create({ latency: 10 }), peerId: 'A', meta: { name: '甲' } });
    await a.connect();
    const b = new NetworkClient({ transport: hub.create({ latency: 10 }), peerId: 'B', meta: { name: '乙' } });
    const joined: [string, unknown][] = [];
    b.onPeerJoin((p) => joined.push([p.id, p.meta.name]));
    const chats: string[] = [];
    b.on('chat', (_d, from) => chats.push(from.id));
    await b.connect();
    a.send('chat', '還不認識你'); // A 還沒收到 B 的 join（要 10ms 才到），就先送出訊息
    await tick(100);
    expect(chats).toEqual(['A']); // 訊息照常收到
    expect(joined).toEqual([['A', '甲']]); // 加入事件等到拿到對方的資料才觸發，只觸發一次
    expect(b.peers.get('A')?.meta).toEqual({ name: '甲' });
  });

  test('指定對象（to）只有對方收到', async () => {
    const hub = new LoopbackHub();
    const clients = ['A', 'B', 'C'].map((id) => new NetworkClient({ transport: hub.create(), peerId: id }));
    await Promise.all(clients.map((c) => c.connect()));
    await tick();
    const got: string[] = [];
    clients[1].on('x', () => got.push('B'));
    clients[2].on('x', () => got.push('C'));
    clients[0].send('x', 1, { to: 'C' });
    await tick();
    expect(got).toEqual(['C']);
    expect(clients[0].peers.size).toBe(2);
  });

  test('請求與回應：成功、錯誤、逾時', async () => {
    const { a, b } = await pair();
    b.handle<number, number>('double', (n) => n * 2);
    b.handle('fail', () => {
      throw new Error('不行');
    });
    await expect(a.request('double', 21, { to: 'B' })).resolves.toBe(42);
    const failed = a.request('fail', null, { to: 'B' });
    const failCheck = expect(failed).rejects.toThrow('不行');
    await tick();
    await failCheck;
    const missing = expect(a.request('nobody', null, { to: 'B' })).rejects.toThrow(/沒有處理/);
    await tick();
    await missing;
    // 廣播請求、沒人處理 → 逾時
    const timeout = expect(a.request('nobody', null, { timeout: 300 })).rejects.toThrow(/逾時/);
    await tick(300);
    await timeout;
  });

  test('心跳：量測延遲；對方無聲無息消失會被移除', async () => {
    const hub = new LoopbackHub();
    const opts = { heartbeatInterval: 100, peerTimeout: 350, reconnect: false, now: () => Date.now() };
    const a = new NetworkClient({ transport: hub.create({ latency: 20 }), peerId: 'A', ...opts });
    const tb = hub.create({ latency: 20 });
    const b = new NetworkClient({ transport: tb, peerId: 'B', ...opts });
    await Promise.all([a.connect(), b.connect()]);
    await tick(250);
    expect(a.peers.get('B')!.rtt).toBeGreaterThanOrEqual(70); // 來回各 40ms
    expect(a.peers.get('B')!.rtt).toBeLessThan(100);

    const left: Peer[] = [];
    a.onPeerLeave((p) => left.push(p));
    tb.close(); // 不說再見直接消失
    await tick(500);
    expect(left.map((p) => p.id)).toEqual(['B']);
  });

  test('主動斷線會通知對方', async () => {
    const { a, b } = await pair();
    const left: string[] = [];
    a.onPeerLeave((p) => left.push(p.id));
    b.disconnect();
    await tick();
    expect(left).toEqual(['B']);
    expect(b.status).toBe('disconnected');
    expect(b.peers.size).toBe(0);
  });

  test('斷線自動重連（等待時間逐次加倍）、斷線期間的訊息重連後補送', async () => {
    const hub = new LoopbackHub();
    const ta = hub.create();
    const a = new NetworkClient({ transport: ta, peerId: 'A', reconnect: { minDelay: 100, maxDelay: 1000 } });
    const b = new NetworkClient({ transport: hub.create(), peerId: 'B' });
    await Promise.all([a.connect(), b.connect()]);
    await tick();
    const statuses: string[] = [];
    a.onStatus((s) => statuses.push(s));
    const got: unknown[] = [];
    b.on('m', (d) => got.push(d));

    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.5); // 去掉隨機：等待 100ms、200ms
    ta.failNextConnect = true;
    hub.drop(ta);
    expect(a.status).toBe('disconnected');
    a.send('m', '離線時送的');
    await tick(130); // 第一次重連（約 100ms）→ 失敗
    expect(a.status).toBe('disconnected');
    await tick(150); // 第二次重連（約 200ms 後）還沒到
    expect(a.connected).toBe(false);
    await tick(150);
    expect(a.connected).toBe(true);
    expect(statuses).toEqual(['disconnected', 'connecting', 'disconnected', 'connecting', 'connected']);
    expect(got).toEqual(['離線時送的']);
    expect(b.peers.has('A')).toBe(true);
    rnd.mockRestore();
  });

  test('訊息處理函式出錯不影響其他處理函式', async () => {
    const { a, b } = await pair();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const got: number[] = [];
    b.on('x', () => {
      throw new Error('壞掉');
    });
    b.on<number>('x', (n) => got.push(n));
    a.send('x', 1);
    await tick();
    expect(got).toEqual([1]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

// ───────── 實體同步 ─────────

const Color = define.component('NetColor', () => ({ value: '' }));

function makeGame(hub: LoopbackHub, id: string, clock: { now: number }) {
  const sched = fakeScheduler();
  const engine = new Engine({ scheduler: sched.scheduler, pauseOnHidden: false });
  const ecs = new EcsPlugin();
  const scene = new ScenePlugin();
  const client = new NetworkClient({ transport: hub.create(), peerId: id, now: () => clock.now * 1000 });
  const net = new NetworkPlugin(client, { sendRate: 10, interpolationDelay: 0.1, now: () => clock.now });
  net.registerPrefab('box', ({ world, entity, data, local }) => {
    world.add(entity, Color, { value: `${(data as { color: string }).color}${local ? '' : '(遠端)'}` });
  });
  engine.use(ecs).use(scene).use(net);
  engine.start();
  /** 推進時間並跑一幀 */
  const frame = (seconds: number) => {
    clock.now += seconds;
    sched.frame(seconds * 1000);
  };
  return { engine, world: ecs.world, client, net, scene, frame };
}

describe('NetworkPlugin 實體同步', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function setup() {
    const hub = new LoopbackHub();
    const clock = { now: 0 };
    const A = makeGame(hub, 'A', clock);
    const B = makeGame(hub, 'B', clock);
    await Promise.all([A.client.connect(), B.client.connect()]);
    await tick();
    /** 兩邊都跑一幀 */
    const step = async (seconds: number) => {
      A.frame(seconds);
      clock.now -= seconds; // 同一段時間：B 不再推進時鐘
      B.frame(seconds);
      await tick();
    };
    return { hub, clock, A, B, step };
  }

  const remoteOf = (g: ReturnType<typeof makeGame>) =>
    g.world.query([NetworkIdentity]).entities.filter((e) => g.world.get(e, NetworkIdentity)!.owner !== g.client.peerId);

  test('建立的實體會出現在對方那邊（用同一個預製物件）', async () => {
    const { A, B } = await setup();
    const e = A.net.spawn('box', { color: 'red' }, { position: new Vector3(1, 2, 3) });
    await tick();
    expect(A.world.get(e, Color)!.value).toBe('red');
    const [r] = remoteOf(B);
    expect(r).toBeDefined();
    expect(B.world.get(r, Color)!.value).toBe('red(遠端)');
    expect(B.world.get(r, Transform)!.position.toArray()).toEqual([1, 2, 3]);
    expect(B.world.get(r, NetworkIdentity)!.owner).toBe('A');
    expect(B.net.remoteCount).toBe(1);
    expect(B.net.entityOf(A.world.get(e, NetworkIdentity)!.netId)).toBe(r);
  });

  test('移動會送給對方，並在快照之間平滑插值', async () => {
    const { A, B, step } = await setup();
    const e = A.net.spawn('box', { color: 'blue' });
    await tick();
    const [r] = remoteOf(B);
    const pos = () => B.world.get(r, Transform)!.position.x;

    // 每 0.1 秒移動 1：A 每 0.1 秒送一次
    for (let i = 1; i <= 10; i++) {
      A.world.get(e, Transform)!.position.x = i;
      await step(0.1);
    }
    // B 顯示的是 0.1 秒前的位置（約 9）
    expect(pos()).toBeGreaterThan(8.5);
    expect(pos()).toBeLessThan(10);
    // 兩個快照之間：半幀時應該在中間
    const before = pos();
    await step(0.05);
    expect(pos()).toBeGreaterThan(before);
    expect(pos()).toBeLessThanOrEqual(10);
    // 停下來以後追上最後的位置
    await step(0.2);
    await step(0.2);
    expect(pos()).toBeCloseTo(10);
  });

  test('沒有變化就不送位置（每秒一次保持）', async () => {
    const { A, step } = await setup();
    A.net.spawn('box', { color: 'x' });
    await tick();
    const sent = () => A.client.stats.messagesSent;
    await step(0.1);
    const s0 = sent();
    for (let i = 0; i < 5; i++) await step(0.1);
    expect(sent() - s0).toBe(0);
    for (let i = 0; i < 6; i++) await step(0.1);
    expect(sent() - s0).toBe(1); // 保持訊號
  });

  test('銷毀實體 → 對方也移除', async () => {
    const { A, B } = await setup();
    const e = A.net.spawn('box', { color: 'x' });
    await tick();
    expect(remoteOf(B)).toHaveLength(1);
    A.world.destroy(e);
    await tick();
    expect(remoteOf(B)).toHaveLength(0);
    expect(B.net.remoteCount).toBe(0);
  });

  test('後加入的玩家會收到現有的實體；玩家離開時他的實體被移除', async () => {
    const { hub, clock, A } = await setup();
    A.net.spawn('box', { color: 'a1' });
    A.net.spawn('box', { color: 'a2' });
    await tick();
    const C = makeGame(hub, 'C', clock);
    await C.client.connect();
    await tick();
    expect(
      remoteOf(C)
        .map((e) => C.world.get(e, Color)!.value)
        .sort(),
    ).toEqual(['a1(遠端)', 'a2(遠端)']);

    A.client.disconnect();
    await tick();
    expect(remoteOf(C)).toHaveLength(0);
  });

  test('遠端實體不隨場景切換而消失；makeNetworked 讓現有實體同步', async () => {
    const { A, B } = await setup();
    B.scene.scenes.register({ name: 'one', setup: () => {} }, { name: 'two', setup: () => {} });
    B.scene.scenes.load('one');
    const e = A.world.spawn(Transform);
    A.net.makeNetworked(e, 'box', { color: 'p' });
    await tick();
    expect(remoteOf(B)).toHaveLength(1);
    B.scene.scenes.load('two');
    expect(remoteOf(B)).toHaveLength(1);
  });

  test('解除安裝會清掉遠端實體與系統', async () => {
    const { A, B } = await setup();
    A.net.spawn('box', { color: 'x' });
    await tick();
    B.engine.removePlugin('network');
    expect(B.engine.hasPlugin?.('network') ?? false).toBe(false);
    expect(remoteOf(B)).toHaveLength(0);
  });
});

// ───────── 轉送伺服器（真的 WebSocket） ─────────

describe('轉送伺服器 server/relay.mjs', () => {
  test('同房間互通、不同房間隔離、斷線時替對方通知離開', async () => {
    const { createRelay } = await import('../server/relay.mjs');
    const relay = createRelay({ port: 0, log: false });
    await relay.ready;
    const url = (room: string) => `ws://127.0.0.1:${relay.port}/${room}`;
    const opts = { heartbeatInterval: 60_000, reconnect: false } as const;
    const a = new NetworkClient({ transport: new WebSocketTransport(url('r1')), peerId: 'A', ...opts });
    const b = new NetworkClient({ transport: new WebSocketTransport(url('r1')), peerId: 'B', ...opts });
    const c = new NetworkClient({ transport: new WebSocketTransport(url('r2')), peerId: 'C', ...opts });
    const until = async (cond: () => boolean) => {
      for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
      expect(cond()).toBe(true);
    };
    try {
      await a.connect();
      await b.connect();
      await c.connect();
      await until(() => a.peers.has('B') && b.peers.has('A'));
      expect(c.peers.size).toBe(0);
      expect(a.peers.has('C')).toBe(false);

      b.handle<string, string>('echo', (s) => s.toUpperCase());
      expect(await a.request('echo', 'hi', { to: 'B' })).toBe('HI');

      // 不說再見直接斷線：伺服器代為通知
      (b as unknown as { transport: WebSocketTransport }).transport.close();
      await until(() => !a.peers.has('B'));
    } finally {
      a.disconnect();
      b.disconnect();
      c.disconnect();
      await relay.close();
    }
  });
});
