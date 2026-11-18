import * as THREE from 'three';
import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, Entity, World } from '../ecs';
import { defineComponent } from '../ecs/Component';
import { Transform, type ScenePlugin } from '../scene';
import type { NetworkClient, Peer } from './NetworkClient';
import { NetworkKey } from './keys';
import { ReplicationKey } from './keys';
import { createLogger } from '../core/Logger';

const log = createLogger('network');
export { ReplicationKey } from './keys';
export { NetworkKey } from './keys';

/**
 * 網路身分：有這個元件的實體會同步給其他玩家。
 * owner 是擁有者（負責送出位置），其他人那邊的是「遠端複本」。
 */
export interface NetworkIdentityData {
  /** 在所有玩家之間共用的編號 */
  netId: string;
  /** 擁有者的玩家編號（只有擁有者能改它的位置） */
  owner: string;
  /** 用哪個預製物件建立遠端複本 */
  prefab: string;
  /** 建立時附帶的資料（顏色、名稱等） */
  data: unknown;
}

/** 多人同步元件：這個實體的位置會同步給其他玩家（用 makeNetworked 加上） */
export const NetworkIdentity = defineComponent<NetworkIdentityData>('NetworkIdentity', () => ({
  netId: '',
  owner: '',
  prefab: '',
  data: null,
}));

/** 預製物件：用來建立同步實體的外觀（本地與遠端都會呼叫，local 區分） */
export type PrefabBuilder = (ctx: {
  world: World;
  entity: Entity;
  data: unknown;
  local: boolean;
  owner: Peer | null;
}) => void;

/** NetworkPlugin 的設定 */
export interface NetworkPluginOptions {
  /** 每秒送出幾次位置（預設 15） */
  sendRate?: number;
  /** 遠端實體延遲多少秒顯示，用來在兩個快照之間插值（預設 0.1，越大越平滑但越延遲） */
  interpolationDelay?: number;
  /** 時間來源（秒，測試用） */
  now?: () => number;
}

interface Snapshot {
  time: number;
  p: THREE.Vector3;
  q: THREE.Quaternion;
  s: THREE.Vector3;
}

interface Remote {
  entity: Entity;
  owner: string;
  buffer: Snapshot[];
}

/** 位置快照：[netId, 位置xyz, 旋轉xyzw, 縮放xyz]（數字四捨五入以縮小封包） */
type SnapItem = [string, number, number, number, number, number, number, number, number, number, number];

const MSG = { spawn: 'net:spawn', despawn: 'net:despawn', snap: 'net:snap' } as const;
const round = (n: number) => Math.round(n * 1000) / 1000;

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * 實體同步外掛：把 NetworkClient 接到 ECS。
 * - spawn() 建立同步實體：其他玩家那邊會用同名的預製物件建立複本
 * - 擁有者定時送出位置；其他人收到後插值顯示，動作平滑
 * - 後加入的玩家會收到現有實體；玩家離線時，他的實體自動移除
 */
export class NetworkPlugin implements Plugin {
  readonly name = 'network';
  readonly dependencies = ['ecs', 'scene'] as const;
  private readonly prefabs = new Map<string, PrefabBuilder>();
  private readonly local = new Map<string, Entity>();
  private readonly remote = new Map<string, Remote>();
  private readonly lastSent = new Map<string, string>();
  private world: World | null = null;
  private engine: Engine | null = null;
  private cleanup: (() => void)[] = [];
  private counter = 0;
  private sendAccumulator = 0;
  private keepAlive = 0;
  private readonly sendInterval: number;
  private readonly delay: number;
  private readonly now: () => number;

  constructor(
    /** 連線 */
    readonly client: NetworkClient,
    options: NetworkPluginOptions = {},
  ) {
    this.sendInterval = 1 / (options.sendRate ?? 15);
    this.delay = options.interpolationDelay ?? 0.1;
    this.now = options.now ?? (() => performance.now() / 1000);
  }

  /** 註冊預製物件（本地與遠端都用這個名稱建立外觀） */
  registerPrefab(name: string, builder: PrefabBuilder): this {
    this.prefabs.set(name, builder);
    return this;
  }

  /** 目前的遠端實體數量 */
  get remoteCount(): number {
    return this.remote.size;
  }

  /** 由網路編號找實體 */
  entityOf(netId: string): Entity | undefined {
    return this.local.get(netId) ?? this.remote.get(netId)?.entity;
  }

  /**
   * 建立同步實體（自己是擁有者）。
   * @example const me = network.spawn('player', { color: '#f80' }, { position: new Vector3(0, 1, 0) });
   */
  spawn(
    prefab: string,
    data: unknown = null,
    transform: { position?: THREE.Vector3; rotation?: THREE.Quaternion } = {},
  ): Entity {
    const world = this.requireWorld();
    const e = world.spawn(Transform);
    const t = world.get(e, Transform)!;
    if (transform.position) t.position.copy(transform.position);
    if (transform.rotation) t.rotation.copy(transform.rotation);
    this.prefabs.get(prefab)?.({ world, entity: e, data, local: true, owner: null });
    return this.makeNetworked(e, prefab, data);
  }

  /** 讓現有的實體變成同步實體（例如場景裡已經建立好的玩家角色） */
  makeNetworked(entity: Entity, prefab: string, data: unknown = null): Entity {
    const world = this.requireWorld();
    if (!world.has(entity, Transform)) world.add(entity, Transform);
    const netId = `${this.client.peerId}:${++this.counter}`;
    world.add(entity, NetworkIdentity, { netId, owner: this.client.peerId, prefab, data });
    this.local.set(netId, entity);
    this.client.send(MSG.spawn, this.spawnMessage(netId, entity));
    return entity;
  }

  install(engine: Engine): void {
    const ecs = engine.getPlugin<EcsPlugin>('ecs')!;
    const world = ecs.world;
    this.world = world;
    this.engine = engine;
    world.setResource(NetworkKey, this.client);
    world.setResource(ReplicationKey, this);

    const net = this.client;
    this.cleanup.push(
      // 自己的同步實體被銷毀：通知其他人
      world.onDestroy((e) => {
        const id = world.get(e, NetworkIdentity);
        if (!id) return;
        if (this.local.delete(id.netId)) net.send(MSG.despawn, id.netId);
        this.remote.delete(id.netId);
      }),
      world.onRemove(NetworkIdentity, (_e, id) => {
        if (this.local.delete(id.netId)) net.send(MSG.despawn, id.netId);
      }),
      // 新玩家加入：把自己現有的同步實體告訴他
      net.onPeerJoin((peer) => {
        for (const [netId, e] of this.local) net.send(MSG.spawn, this.spawnMessage(netId, e), { to: peer.id });
      }),
      // 玩家離線：移除他的實體
      net.onPeerLeave((peer) => {
        for (const [netId, r] of [...this.remote]) {
          if (r.owner === peer.id) {
            this.remote.delete(netId);
            world.destroy(r.entity);
          }
        }
      }),
      net.on<SpawnMessage>(MSG.spawn, (msg, from) => this.onSpawn(msg, from)),
      net.on<string>(MSG.despawn, (netId) => {
        const r = this.remote.get(netId);
        if (!r) return;
        this.remote.delete(netId);
        world.destroy(r.entity);
      }),
      net.on<SnapItem[]>(MSG.snap, (items) => this.onSnapshot(items)),
    );

    // 送出（變換計算之後）與插值顯示（變換計算之前）
    ecs.addSystem({
      name: 'network-send',
      phase: 'lateUpdate',
      priority: 1100,
      run: (_w, t) => this.sendSnapshots(t.realDelta || t.unscaledDelta),
    });
    ecs.addSystem({ name: 'network-interpolate', phase: 'lateUpdate', priority: 950, run: () => this.interpolate() });
  }

  uninstall(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    const ecs = this.engine?.getPlugin<EcsPlugin>('ecs');
    ecs?.removeSystem('network-send').removeSystem('network-interpolate');
    for (const r of this.remote.values()) this.world?.destroy(r.entity);
    this.remote.clear();
    this.local.clear();
    this.world?.removeResource(NetworkKey);
    this.world?.removeResource(ReplicationKey);
    this.world = this.engine = null;
  }

  // ───────── 內部 ─────────

  private requireWorld(): World {
    if (!this.world) throw new Error('NetworkPlugin 尚未安裝');
    return this.world;
  }

  private spawnMessage(netId: string, e: Entity): SpawnMessage {
    const world = this.requireWorld();
    const id = world.get(e, NetworkIdentity)!;
    const t = world.get(e, Transform)!;
    return { netId, prefab: id.prefab, data: id.data, t: this.snapItem(netId, t).slice(1) as number[] };
  }

  private snapItem(
    netId: string,
    t: { position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3 },
  ): SnapItem {
    const { position: p, rotation: q, scale: s } = t;
    return [
      netId,
      round(p.x),
      round(p.y),
      round(p.z),
      round(q.x),
      round(q.y),
      round(q.z),
      round(q.w),
      round(s.x),
      round(s.y),
      round(s.z),
    ];
  }

  private onSpawn(msg: SpawnMessage, from: Peer): void {
    const world = this.requireWorld();
    if (this.remote.has(msg.netId) || this.local.has(msg.netId)) return;
    const e = world.spawn(Transform);
    const t = world.get(e, Transform)!;
    const [px, py, pz, qx, qy, qz, qw, sx, sy, sz] = msg.t;
    t.position.set(px, py, pz);
    t.rotation.set(qx, qy, qz, qw);
    t.scale.set(sx, sy, sz);
    world.add(e, NetworkIdentity, { netId: msg.netId, owner: from.id, prefab: msg.prefab, data: msg.data });
    // 遠端玩家的實體不屬於任何場景：切換場景時不會被移除
    this.engine?.getPlugin<ScenePlugin>('scene')?.scenes.persist(e);
    const builder = this.prefabs.get(msg.prefab);
    if (builder) builder({ world, entity: e, data: msg.data, local: false, owner: from });
    else log.warn(`沒有註冊預製物件「${msg.prefab}」：遠端實體 ${msg.netId} 只有位置、沒有外觀`);
    this.remote.set(msg.netId, {
      entity: e,
      owner: from.id,
      buffer: [{ time: this.now(), p: t.position.clone(), q: t.rotation.clone(), s: t.scale.clone() }],
    });
  }

  private onSnapshot(items: SnapItem[]): void {
    const time = this.now();
    for (const [netId, px, py, pz, qx, qy, qz, qw, sx, sy, sz] of items) {
      const r = this.remote.get(netId);
      if (!r) continue;
      r.buffer.push({
        time,
        p: new THREE.Vector3(px, py, pz),
        q: new THREE.Quaternion(qx, qy, qz, qw),
        s: new THREE.Vector3(sx, sy, sz),
      });
      if (r.buffer.length > 30) r.buffer.shift();
    }
  }

  /** 定時送出自己實體的位置（只送有變化的；每秒至少一次當作保持） */
  private sendSnapshots(dt: number): void {
    if (!this.client.connected || this.local.size === 0) return;
    this.sendAccumulator += dt;
    if (this.sendAccumulator < this.sendInterval) return;
    this.sendAccumulator %= this.sendInterval;
    this.keepAlive += this.sendInterval;
    const forceAll = this.keepAlive >= 1;
    if (forceAll) this.keepAlive = 0;
    const world = this.requireWorld();
    const items: SnapItem[] = [];
    for (const [netId, e] of this.local) {
      const t = world.get(e, Transform);
      if (!t) continue;
      const item = this.snapItem(netId, t);
      const key = item.join(',');
      if (!forceAll && this.lastSent.get(netId) === key) continue;
      this.lastSent.set(netId, key);
      items.push(item);
    }
    if (items.length) this.client.send(MSG.snap, items);
  }

  /** 遠端實體：顯示「現在 − 延遲」那一刻的位置，在前後兩個快照之間插值 */
  private interpolate(): void {
    const world = this.world;
    if (!world || this.remote.size === 0) return;
    const renderTime = this.now() - this.delay;
    for (const r of this.remote.values()) {
      const t = world.get(r.entity, Transform);
      const b = r.buffer;
      if (!t || b.length === 0) continue;
      // 丟掉太舊的快照（保留 renderTime 之前的最後一個）
      while (b.length >= 2 && b[1].time <= renderTime) b.shift();
      const a = b[0];
      const next = b[1];
      if (!next || renderTime <= a.time) {
        t.position.copy(a.p);
        t.rotation.copy(a.q);
        t.scale.copy(a.s);
        continue;
      }
      const k = Math.min(1, (renderTime - a.time) / Math.max(1e-6, next.time - a.time));
      t.position.copy(_p.lerpVectors(a.p, next.p, k));
      t.rotation.copy(_q.slerpQuaternions(a.q, next.q, k));
      t.scale.copy(_s.lerpVectors(a.s, next.s, k));
    }
  }
}

interface SpawnMessage {
  netId: string;
  prefab: string;
  data: unknown;
  /** 位置xyz、旋轉xyzw、縮放xyz */
  t: number[];
}
