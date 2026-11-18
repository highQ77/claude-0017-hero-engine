import type { Engine } from '../core/Engine';
import type { ComponentType, Entity, EventType, ResourceKey, World } from '../ecs';
import type { EveryOptions, TimerHandle, TimerOptions } from '../core/Timers';
import type { CollisionEvent } from '../physics/Physics';
import type { RaycastHit } from '../render/RenderPlugin';
import { Transform, type TransformData } from '../scene';
import { InputKey } from '../input/keys';
import { AudioKey } from '../audio/keys';
import { PhysicsKey } from '../physics/keys';
import { TweensKey } from '../animation/keys';
import { AssetsKey } from '../assets/keys';
import type { ScriptRunner } from './ScriptRunner';

/** 腳本類別（建構式不能有參數） */
export type ScriptClass<T extends Script = Script> = new () => T;

/**
 * 行為腳本：用類別替實體寫行為（類似 Unity 的 MonoBehaviour）。
 * 所有生命週期方法都是選擇性的，只寫需要的即可。
 * 注意：建構式執行時還沒有 entity，初始化請寫在 onAwake 或 onStart。
 *
 * @example
 * class Rotator extends Script {
 *   speed = 1;                                  // 可在 addScript 時用 props 設定
 *   onUpdate(dt: number) {
 *     this.transform.rotation.y += this.speed * dt;
 *   }
 *   onCollisionEnter(other: Entity) {
 *     this.audio.play('sfx/hit.wav');
 *   }
 * }
 * scripts.add(entity, Rotator, { speed: 3 });
 */
export abstract class Script {
  /** 腳本執行順序：數字小的先執行（同一階段內） */
  static executionOrder = 0;

  // ───────── 由 ScriptRunner 注入 ─────────
  /** 所屬實體 */
  entity!: Entity;
  /** ECS 世界 */
  world!: World;
  /** 引擎 */
  engine!: Engine;
  /** @internal */
  _runner!: ScriptRunner;
  /** @internal */
  _started = false;
  /** @internal */
  _alive = false;
  /** @internal */
  _order = 0;
  private _enabled = true;

  // ───────── 生命週期（選擇性覆寫） ─────────

  /** 加到實體上時立刻呼叫（只呼叫一次） */
  onAwake?(): void;
  /** 第一次更新前呼叫（只呼叫一次；停用中會延到啟用時） */
  onStart?(): void;
  /** 每幀呼叫，dt 為遊戲時間（受時間縮放影響） */
  onUpdate?(dt: number): void;
  /** 固定時間步長呼叫（物理更新前），適合施力 */
  onFixedUpdate?(dt: number): void;
  /** 每幀在物理寫回位置之後、變換計算之前呼叫，適合攝影機跟隨 */
  onLateUpdate?(dt: number): void;
  /** 腳本啟用時呼叫（enabled 設成 true） */
  onEnable?(): void;
  /** 腳本停用時呼叫（enabled 設成 false） */
  onDisable?(): void;
  /** 腳本被移除或實體被銷毀時呼叫 */
  onDestroy?(): void;

  /** 開始碰到其他物體（需要 PhysicsPlugin） */
  onCollisionEnter?(other: Entity, event: CollisionEvent): void;
  /** 碰撞結束時呼叫 */
  onCollisionExit?(other: Entity, event: CollisionEvent): void;
  /** 進入感應器（自己或對方是感應器） */
  onTriggerEnter?(other: Entity, event: CollisionEvent): void;
  /** 離開觸發區（sensor）時呼叫 */
  onTriggerExit?(other: Entity, event: CollisionEvent): void;

  /** 被滑鼠或手指點擊（需要 InputPlugin 與 RenderPlugin） */
  onClick?(hit: RaycastHit): void;
  /** 滑鼠移入、移出 */
  onPointerEnter?(hit: RaycastHit): void;
  /** 滑鼠移出實體時呼叫 */
  onPointerExit?(): void;

  // ───────── 啟用狀態 ─────────

  /** 是否啟用：停用時不會呼叫 onUpdate 等 */
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    if (value === this._enabled) return;
    this._enabled = value;
    if (this._alive) this._runner._enabledChanged(this);
  }

  /** 腳本是否還存在（被移除或實體被銷毀後為 false） */
  get alive(): boolean {
    return this._alive;
  }

  // ───────── 實體與元件 ─────────

  /** 實體的 Transform（沒有時會報錯） */
  get transform(): TransformData {
    return this.world.require(this.entity, Transform);
  }

  /** 取得自己身上的元件（沒有時是 undefined） */
  get<T>(type: ComponentType<T>): T | undefined {
    return this.world.get(this.entity, type);
  }

  /** 取得自己身上的元件（沒有時拋出錯誤） */
  require<T>(type: ComponentType<T>): T {
    return this.world.require(this.entity, type);
  }

  /** 在自己身上加元件 */
  add<T>(type: ComponentType<T>, init?: Partial<T>): T {
    return this.world.add(this.entity, type, init);
  }

  /** 自己身上是否有這個元件 */
  has(type: ComponentType<unknown>): boolean {
    return this.world.has(this.entity, type);
  }

  /** 移除自己身上的元件 */
  remove(type: ComponentType<unknown>): boolean {
    return this.world.remove(this.entity, type);
  }

  /** 取得實體上的另一個腳本（預設為自己的實體） */
  getScript<T extends Script>(cls: ScriptClass<T>, entity: Entity = this.entity): T | undefined {
    return this._runner.get(entity, cls);
  }

  /** 依名稱尋找實體（需要 Name 元件） */
  find(name: string): Entity | undefined {
    return this._runner.find(name);
  }

  /**
   * 呼叫某個實體上所有腳本的同名方法（沒有該方法的腳本會略過）。
   * @example this.sendMessage(enemy, 'takeDamage', 10)
   */
  sendMessage(entity: Entity, method: string, ...args: unknown[]): void {
    this._runner.sendMessage(entity, method, ...args);
  }

  /** 銷毀實體（在這一階段結束時執行） */
  destroy(entity: Entity = this.entity): void {
    this.world.defer(() => this.world.destroy(entity));
  }

  // ───────── 等待（遊戲時間） ─────────

  /**
   * 等待遊戲時間。腳本在等待期間被銷毀時，await 之後的程式碼不會執行。
   * @example
   * class Countdown extends Script {
   *   async onStart() {
   *     await this.wait(2); // 兩秒後
   *     this.audio.play('sfx/ready.wav');
   *   }
   * }
   */
  wait(seconds: number): Promise<void> {
    return this._runner._wait(this, { seconds });
  }

  /** 等到下一幀 */
  nextFrame(): Promise<void> {
    return this._runner._wait(this, { frames: 1 });
  }

  /** 每幀檢查，條件成立時繼續 */
  waitUntil(condition: () => boolean): Promise<void> {
    return this._runner._wait(this, { until: condition });
  }

  // ───────── 計時器、事件（腳本結束時自動取消） ─────────

  /** @internal 腳本結束時要取消的計時器、事件收聽 */
  _cleanup: (() => void)[] = [];

  /** 幾秒後執行一次（engine.timers.after；腳本結束時自動取消） */
  after(seconds: number, fn: () => void, options: TimerOptions = {}): TimerHandle {
    const h = this.engine.timers.after(seconds, fn, options);
    this._cleanup.push(() => h.cancel());
    return h;
  }

  /** 每隔幾秒執行一次（engine.timers.every；腳本結束時自動取消） */
  every(seconds: number, fn: () => void, options: EveryOptions = {}): TimerHandle {
    const h = this.engine.timers.every(seconds, fn, options);
    this._cleanup.push(() => h.cancel());
    return h;
  }

  /**
   * 收聽事件（world.events.on）；腳本結束時（實體銷毀或移除腳本）自動取消。回傳取消的函式。
   * @example
   * const CoinCollected = define.event<{ value: number }>('CoinCollected');
   *
   * class ScoreKeeper extends Script {
   *   score = 0;
   *   onStart() {
   *     this.on(CoinCollected, (e) => (this.score += e.value));
   *   }
   * }
   */
  on<T>(type: EventType<T>, handler: (payload: T) => void): () => void {
    const off = this.world.events.on(type, handler);
    this._cleanup.push(off);
    return off;
  }

  /** 發出事件（world.events.emit） */
  emit<T>(type: EventType<T>, ...payload: T extends void ? [] : [T]): void {
    this.world.events.emit(type, ...payload);
  }

  // ───────── 常用資源的捷徑（需要安裝對應外掛） ─────────

  /** 取得資源（沒有時拋出錯誤） */
  resource<T>(key: ResourceKey<T>): T {
    return this.world.requireResource(key);
  }

  /** 輸入（鍵盤、滑鼠、手把、動作） */
  get input() {
    return this.resource(InputKey);
  }

  /** 音效 */
  get audio() {
    return this.resource(AudioKey);
  }

  /** 物理世界 */
  get physics() {
    return this.resource(PhysicsKey);
  }

  /** 補間動畫 */
  get tweens() {
    return this.resource(TweensKey);
  }

  /** 資源管理（載入圖片、音效、模型） */
  get assets() {
    return this.resource(AssetsKey);
  }
}
