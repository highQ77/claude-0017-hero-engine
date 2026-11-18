import type { Engine } from '../core/Engine';
import type { Entity, World } from '../ecs';
import { defineComponent } from '../ecs/Component';
import type { CollisionEvent } from '../physics/Physics';
import { PhysicsKey } from '../physics/keys';
import { InputKey } from '../input/keys';
import type { RaycastHit } from '../render/RenderPlugin';
import { RenderKey } from '../render/keys';
import { HierarchyKey, Name } from '../scene';
import type { Script, ScriptClass } from './Script';
import { createLogger } from '../core/Logger';

const log = createLogger('scripts');

/** 實體上的腳本清單（由 ScriptRunner 管理，請用 scripts.add / remove） */
export const Scripts = defineComponent<{ list: Script[] }>('Scripts', () => ({ list: [] }));

/** 實體名稱（定義在場景模組，這裡照舊轉出，原本的 import 不用改） */
export { Name };

interface Waiter {
  script: Script;
  /** 建立時的幀數：同一幀不計時，從下一幀開始算 */
  frame: number;
  seconds?: number;
  frames?: number;
  until?: () => boolean;
  resolve: () => void;
}

/** ScriptRunner 的設定 */
export interface ScriptRunnerOptions {
  /** 腳本錯誤時直接拋出（測試用）；預設 false：記錄錯誤並繼續執行其他腳本 */
  rethrow?: boolean;
}

type LifecycleMethod = 'onUpdate' | 'onFixedUpdate' | 'onLateUpdate';

/**
 * 腳本執行器：管理所有腳本的生命週期、事件分派與等待。
 * 透過 world.requireResource(ScriptsKey) 取得，或用 ScriptPlugin.runner。
 */
export class ScriptRunner {
  private readonly all: Script[] = [];
  private sorted = true;
  private pendingStart: Script[] = [];
  private waiters: Waiter[] = [];
  private attachCounter = 0;
  private hovered: { entity: Entity; script: Script }[] = [];
  private physicsSubscribed: object | null = null;
  private offPhysics: (() => void) | null = null;
  private readonly offs: (() => void)[] = [];

  constructor(
    /** ECS 世界 */
    readonly world: World,
    /** 引擎 */
    readonly engine: Engine,
    private readonly options: ScriptRunnerOptions = {},
  ) {
    const endAll = (data: { list: Script[] }) => {
      for (const s of [...data.list]) this.terminate(s);
      data.list.length = 0;
    };
    this.offs.push(
      // 實體銷毀：在元件被移除之前結束腳本，onDestroy 裡還能讀取 Transform 等元件
      world.onDestroy((e) => {
        const data = world.get(e, Scripts);
        if (data) endAll(data);
      }),
      // 直接移除 Scripts 元件
      world.onRemove(Scripts, (_e, data) => endAll(data)),
    );
  }

  /** 目前存在的腳本數量 */
  get count(): number {
    return this.all.length;
  }

  // ───────── 登記腳本類別（場景檔用名稱找類別） ─────────

  private readonly registry = new Map<string, ScriptClass>();

  /**
   * 用名稱登記腳本類別：場景檔（ScriptList）用這個名稱找到類別。
   * 用物件的鍵當名稱（不是類別的 name：打包壓縮後類別名稱會變）。
   * @example
   * scripts.register({ Coin, Rotator });
   */
  register(classes: Record<string, ScriptClass>): this {
    for (const [name, cls] of Object.entries(classes)) {
      if (typeof cls !== 'function') throw new Error(`scripts.register：「${name}」不是腳本類別`);
      this.registry.set(name, cls);
    }
    return this;
  }

  /** 依名稱取得登記的腳本類別（沒有時是 undefined） */
  registered(name: string): ScriptClass | undefined {
    return this.registry.get(name);
  }

  /** 所有登記的腳本名稱 */
  registeredNames(): string[] {
    return [...this.registry.keys()].sort();
  }

  // ───────── 管理腳本 ─────────

  /**
   * 把腳本加到實體上，回傳腳本實例。
   * @param props 在 onAwake 之前設定的欄位值（像 Unity Inspector 的參數）
   */
  add<T extends Script>(entity: Entity, cls: ScriptClass<T>, props: Partial<Omit<T, keyof Script>> = {}): T {
    if (!this.world.isAlive(entity)) throw new Error(`無法把 ${cls.name} 加到已銷毀的實體`);
    const script = new cls();
    Object.assign(script, props);
    script.entity = entity;
    script.world = this.world;
    script.engine = this.engine;
    script._runner = this;
    script._alive = true;
    script._order = this.attachCounter++;
    this.world.add(entity, Scripts).list.push(script);
    this.all.push(script);
    this.sorted = false;

    this.call(script, 'onAwake');
    if (script._alive && script.enabled) {
      this.call(script, 'onEnable');
      this.pendingStart.push(script);
    }
    return script;
  }

  /** 取得實體上第一個屬於某類別的腳本 */
  get<T extends Script>(entity: Entity, cls: ScriptClass<T>): T | undefined {
    return this.world.get(entity, Scripts)?.list.find((s): s is T => s instanceof cls);
  }

  /** 實體身上的所有腳本 */
  getAll(entity: Entity): readonly Script[] {
    return this.world.get(entity, Scripts)?.list ?? [];
  }

  /** 移除腳本（傳實例，或類別以移除該類別的第一個） */
  remove(entity: Entity, target: Script | ScriptClass): boolean {
    const data = this.world.get(entity, Scripts);
    if (!data) return false;
    const i = data.list.findIndex((s) => (typeof target === 'function' ? s instanceof target : s === target));
    if (i === -1) return false;
    const [script] = data.list.splice(i, 1);
    this.terminate(script);
    return true;
  }

  /** 依名稱找實體（Name 元件） */
  find(name: string): Entity | undefined {
    for (const e of this.world.query([Name]).entities) {
      if (this.world.get(e, Name)!.value === name) return e;
    }
    return undefined;
  }

  /** 呼叫實體身上所有腳本的同名方法（例如 sendMessage(e, 'onHit', 10)） */
  sendMessage(entity: Entity, method: string, ...args: unknown[]): void {
    for (const s of [...this.getAll(entity)]) {
      const fn = (s as unknown as Record<string, unknown>)[method];
      if (typeof fn === 'function' && s._alive) this.guard(s, method, () => fn.apply(s, args));
    }
  }

  // ───────── 每幀流程（由 ScriptPlugin 呼叫） ─────────

  /** update 階段：結算等待 → onStart → 點擊／滑鼠事件 → onUpdate */
  update(dt: number): void {
    this.subscribePhysics();
    this.processWaiters(dt);
    this.startPending();
    this.pointerEvents();
    this.run('onUpdate', dt);
  }

  /** 執行所有腳本的 onFixedUpdate（由外掛呼叫） */
  fixedUpdate(dt: number): void {
    this.subscribePhysics();
    this.startPending();
    this.run('onFixedUpdate', dt);
  }

  /** 執行所有腳本的 onLateUpdate（由外掛呼叫） */
  lateUpdate(dt: number): void {
    this.run('onLateUpdate', dt);
  }

  /** 移除所有腳本 */
  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.offPhysics?.();
    for (const s of [...this.all]) this.terminate(s);
    this.waiters = [];
  }

  // ───────── 給 Script 使用 ─────────

  /** @internal */
  _enabledChanged(script: Script): void {
    if (script.enabled) {
      this.call(script, 'onEnable');
      if (!script._started && !this.pendingStart.includes(script)) this.pendingStart.push(script);
    } else {
      this.call(script, 'onDisable');
    }
  }

  /** @internal */
  _wait(script: Script, condition: Omit<Waiter, 'script' | 'resolve' | 'frame'>): Promise<void> {
    return new Promise((resolve) => {
      if (!script._alive) return; // 已銷毀：永遠不會繼續
      this.waiters.push({ script, ...condition, frame: this.engine.time.frame, resolve });
    });
  }

  // ───────── 內部 ─────────

  private run(method: LifecycleMethod, dt: number): void {
    if (!this.sorted) {
      // 依 executionOrder，再依加入順序
      this.all.sort((a, b) => orderOf(a) - orderOf(b) || a._order - b._order);
      this.sorted = true;
    }
    for (const s of this.all.slice()) {
      if (!s._alive || !s._started || !s.enabled) continue;
      const fn = s[method];
      if (fn) this.guard(s, method, () => fn.call(s, dt));
    }
  }

  private startPending(): void {
    if (this.pendingStart.length === 0) return;
    const list = this.pendingStart;
    this.pendingStart = [];
    for (const s of list) {
      if (!s._alive || s._started) continue;
      if (!s.enabled) continue; // 啟用時會重新排入
      s._started = true;
      this.call(s, 'onStart');
    }
  }

  private processWaiters(dt: number): void {
    if (this.waiters.length === 0) return;
    const list = this.waiters;
    this.waiters = [];
    const frame = this.engine.time.frame;
    for (const w of list) {
      if (!w.script._alive) continue; // 腳本已銷毀：丟棄
      if (w.frame === frame) {
        this.waiters.push(w); // 這一幀才開始等，下一幀再計時
        continue;
      }
      let done = false;
      if (w.seconds !== undefined) {
        w.seconds -= dt;
        done = w.seconds <= 0;
      } else if (w.frames !== undefined) {
        done = --w.frames <= 0;
      } else if (w.until) {
        done = this.guard(w.script, 'waitUntil', () => w.until!()) === true;
      }
      if (done) w.resolve();
      else this.waiters.push(w);
    }
  }

  private terminate(script: Script): void {
    if (!script._alive) return;
    if (script.enabled) this.call(script, 'onDisable');
    this.call(script, 'onDestroy');
    script._alive = false;
    for (const fn of script._cleanup.splice(0)) fn(); // 腳本的計時器、事件收聽
    const i = this.all.indexOf(script);
    if (i !== -1) this.all.splice(i, 1);
    this.hovered = this.hovered.filter((h) => h.script !== script);
  }

  private call(script: Script, method: 'onAwake' | 'onStart' | 'onEnable' | 'onDisable' | 'onDestroy'): void {
    const fn = script[method];
    if (fn) this.guard(script, method, () => fn.call(script));
  }

  /** 執行腳本程式碼：出錯時記錄是哪個腳本、哪個方法，不影響其他腳本 */
  private guard<R>(script: Script, method: string, fn: () => R): R | undefined {
    try {
      const result = fn();
      if (result instanceof Promise) {
        result.catch((error: unknown) => this.report(script, method, error));
      }
      return result;
    } catch (error) {
      this.report(script, method, error);
      return undefined;
    }
  }

  private report(script: Script, method: string, error: unknown): void {
    if (this.options.rethrow) throw error;
    log.error(`腳本 ${script.constructor.name}（實體 ${script.entity}）的 ${method} 發生錯誤：`, error);
  }

  // ───────── 物理事件 ─────────

  private subscribePhysics(): void {
    const physics = this.world.getResource(PhysicsKey);
    if (!physics || this.physicsSubscribed === physics) return;
    this.offPhysics?.();
    this.physicsSubscribed = physics;
    this.offPhysics = physics.onCollision((ev) => this.dispatchCollision(ev));
  }

  private dispatchCollision(ev: CollisionEvent): void {
    const deliver = (self: Entity, other: Entity) => {
      const target = this.scriptOwner(self);
      if (target === null) return;
      const method = ev.sensor
        ? ev.started
          ? 'onTriggerEnter'
          : 'onTriggerExit'
        : ev.started
          ? 'onCollisionEnter'
          : 'onCollisionExit';
      for (const s of [...this.getAll(target)]) {
        const fn = s[method];
        if (fn && s._alive && s.enabled) this.guard(s, method, () => fn.call(s, other, ev));
      }
    };
    deliver(ev.a, ev.b);
    deliver(ev.b, ev.a);
  }

  /** 自己或最近的祖先中，有腳本的實體（組合碰撞形狀的子實體會交給父實體的腳本） */
  private scriptOwner(e: Entity): Entity | null {
    const hierarchy = this.world.getResource(HierarchyKey);
    for (let cur: Entity | null = e; cur !== null; cur = hierarchy?.parentOf(cur) ?? null) {
      if (this.world.has(cur, Scripts)) return cur;
      if (!hierarchy) break;
    }
    return null;
  }

  // ───────── 點擊與滑鼠移入移出 ─────────

  private pointerEvents(): void {
    const input = this.world.getResource(InputKey);
    const render = this.world.getResource(RenderKey);
    if (!input || !render) return;
    const wantsHover = this.all.some((s) => s.onPointerEnter || s.onPointerExit);
    const clicked = input.wasPressed('Mouse:Left');
    if (!wantsHover && !clicked) return;

    const hit = render.pick(input.pointer.ndcX, input.pointer.ndcY);
    const owner = hit ? this.scriptOwner(hit.entity) : null;

    if (wantsHover) {
      const now = owner !== null ? this.getAll(owner).filter((s) => s.enabled) : [];
      for (const h of this.hovered) {
        if (!now.includes(h.script) && h.script._alive)
          this.guard(h.script, 'onPointerExit', () => h.script.onPointerExit?.());
      }
      for (const s of now) {
        if (!this.hovered.some((h) => h.script === s)) this.guard(s, 'onPointerEnter', () => s.onPointerEnter?.(hit!));
      }
      this.hovered = now.map((script) => ({ entity: owner!, script }));
    }
    if (clicked && owner !== null && hit) {
      for (const s of [...this.getAll(owner)]) {
        if (s.onClick && s._alive && s.enabled) this.guard(s, 'onClick', () => s.onClick!(hit as RaycastHit));
      }
    }
  }
}

function orderOf(script: Script): number {
  return (script.constructor as typeof Script).executionOrder ?? 0;
}
