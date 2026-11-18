import { ComponentStore, type ComponentType } from './Component';
import { EntityPool, type Entity } from './Entity';
import { EventBus } from './Events';
import { Query, type QueryOptions } from './Query';

import type { ResourceKey } from './Resource';
export { defineResource, type ResourceKey } from './Resource';

/** spawn 時的元件描述：只給類型，或給類型加初始值 */
export type ComponentInit = ComponentType<unknown> | readonly [ComponentType<unknown>, object];

type EntityHook = (e: Entity) => void;
type ComponentHook<T> = (e: Entity, value: T) => void;

/**
 * 世界：存放所有實體、元件、資源，並提供查詢。
 */
export class World {
  /** 事件：events.on(事件, 函式)、events.emit(事件, 內容)（實體銷毀時，綁定它的收聽自動取消） */
  readonly events = new EventBus();
  private readonly pool = new EntityPool();
  /** 以元件 id 為索引 */
  private readonly stores: ComponentStore<unknown>[] = [];
  private readonly queries = new Map<string, Query<readonly ComponentType<unknown>[]>>();
  private readonly queriesByComponent = new Map<number, Query<readonly ComponentType<unknown>[]>[]>();
  private readonly addHooks = new Map<number, Set<ComponentHook<unknown>>>();
  private readonly removeHooks = new Map<number, Set<ComponentHook<unknown>>>();
  private readonly createHooks = new Set<EntityHook>();
  private readonly destroyHooks = new Set<EntityHook>();
  private readonly resources = new Map<ResourceKey<unknown>, unknown>();
  private readonly deferred: (() => void)[] = [];
  private readonly destroying = new Set<Entity>();

  // ───────── 實體 ─────────

  /** 建立沒有元件的實體 */
  create(): Entity {
    const e = this.pool.create();
    for (const hook of [...this.createHooks]) hook(e);
    return e;
  }

  /**
   * 建立實體並一次加上多個元件。
   * @example
   * world.spawn(Player, [Transform, { position: new Vector3(0, 1, 0) }], Health.with({ hp: 100 }));
   */
  spawn(...components: ComponentInit[]): Entity {
    const e = this.create();
    for (const c of components) {
      if (Array.isArray(c)) this.add(e, c[0], c[1]);
      else this.add(e, c as ComponentType<unknown>);
    }
    return e;
  }

  /** 銷毀實體，移除它所有元件。回傳是否真的有銷毀 */
  destroy(e: Entity): boolean {
    if (!this.pool.isAlive(e) || this.destroying.has(e)) return false;
    this.destroying.add(e);
    try {
      for (const hook of [...this.destroyHooks]) hook(e);
      this.events.offOwner(e);
      this.stores.forEach((store, id) => {
        const value = store.delete(e);
        if (value !== undefined) this.afterRemove(id, e, value);
      });
      this.pool.release(e);
    } finally {
      this.destroying.delete(e);
    }
    return true;
  }

  /** 實體是否還存在（沒有被銷毀） */
  isAlive(e: Entity): boolean {
    return this.pool.isAlive(e);
  }

  /** 目前的實體數量 */
  get entityCount(): number {
    return this.pool.alive.size;
  }

  /** 銷毀所有實體（資源保留） */
  clear(): void {
    for (const e of [...this.pool.alive]) this.destroy(e);
  }

  // ───────── 元件 ─────────

  /**
   * 加上元件並回傳資料。若已有此元件，會把 init 合併進現有資料（不觸發 onAdd）。
   */
  add<T>(e: Entity, type: ComponentType<T>, init?: Partial<T>): T {
    if (!this.pool.isAlive(e)) throw new Error(`無法對已銷毀的實體加上「${type.name}」`);
    const store = this.storeOf(type);
    const existing = store.get(e);
    if (existing !== undefined) {
      if (init) Object.assign(existing as object, init);
      return existing;
    }
    const value = type.create();
    if (init) Object.assign(value as object, init);
    store.set(e, value);
    this.invalidate(type.id);
    const hooks = this.addHooks.get(type.id);
    if (hooks) for (const hook of [...hooks]) hook(e, value);
    return value;
  }

  /** 移除元件，回傳是否真的有移除 */
  remove<T>(e: Entity, type: ComponentType<T>): boolean {
    const store = this.stores[type.id];
    const value = store?.delete(e);
    if (value === undefined) return false;
    this.afterRemove(type.id, e, value);
    return true;
  }

  /** 取得元件資料（沒有時是 undefined） */
  get<T>(e: Entity, type: ComponentType<T>): T | undefined {
    return (this.stores[type.id] as ComponentStore<T> | undefined)?.get(e);
  }

  /** 取得一定存在的元件；沒有時拋出清楚的錯誤（不用寫 world.get(e, T)!） */
  require<T>(e: Entity, type: ComponentType<T>): T {
    const value = this.get(e, type);
    if (value === undefined)
      throw new Error(
        this.isAlive(e) ? `實體 ${e} 沒有元件「${type.name}」` : `實體 ${e} 已經銷毀（要取得「${type.name}」）`,
      );
    return value;
  }

  /** 是否有這個元件 */
  has(e: Entity, type: ComponentType<unknown>): boolean {
    return this.stores[type.id]?.has(e) ?? false;
  }

  // ───────── 查詢 ─────────

  /**
   * 取得查詢（同樣條件會共用同一個快取）。
   * @example
   * const movers = world.query([Transform, Velocity], { none: [Frozen] });
   */
  query<const Cs extends readonly ComponentType<unknown>[]>(all: Cs, options: QueryOptions = {}): Query<Cs> {
    if (all.length === 0) throw new Error('查詢至少需要一種元件');
    const none = options.none ?? [];
    const key =
      all
        .map((c) => c.id)
        .sort((a, b) => a - b)
        .join(',') +
      '|' +
      none
        .map((c) => c.id)
        .sort((a, b) => a - b)
        .join(',');
    let q = this.queries.get(key) as Query<Cs> | undefined;
    if (!q) {
      q = new Query(
        all,
        none,
        all.map((c) => this.storeOf(c)),
        none.map((c) => this.storeOf(c)),
      );
      this.queries.set(key, q);
      for (const c of [...all, ...none]) {
        let list = this.queriesByComponent.get(c.id);
        if (!list) this.queriesByComponent.set(c.id, (list = []));
        list.push(q);
      }
    }
    return q;
  }

  // ───────── 事件掛鉤 ─────────

  /** 元件加上後觸發（可用來建立對應的 three.js 物件） */
  onAdd<T>(type: ComponentType<T>, hook: ComponentHook<T>): () => void {
    return subscribe(this.addHooks, type.id, hook);
  }

  /** 元件移除後觸發，帶著被移除的資料（可用來釋放資源） */
  onRemove<T>(type: ComponentType<T>, hook: ComponentHook<T>): () => void {
    return subscribe(this.removeHooks, type.id, hook);
  }

  /** 有實體建立時通知，回傳取消監聽的函式 */
  onCreate(hook: EntityHook): () => void {
    this.createHooks.add(hook);
    return () => this.createHooks.delete(hook);
  }

  /** 實體銷毀前觸發（此時元件都還在） */
  onDestroy(hook: EntityHook): () => void {
    this.destroyHooks.add(hook);
    return () => this.destroyHooks.delete(hook);
  }

  // ───────── 資源 ─────────

  /** 設定資源 */
  setResource<T>(key: ResourceKey<T>, value: T): void {
    this.resources.set(key, value);
  }

  /** 取得資源（沒有時是 undefined） */
  getResource<T>(key: ResourceKey<T>): T | undefined {
    return this.resources.get(key) as T | undefined;
  }

  /** 取得資源（沒有時拋出錯誤，說明要安裝哪個外掛） */
  requireResource<T>(key: ResourceKey<T>): T {
    if (!this.resources.has(key)) throw new Error(`找不到資源「${key.name}」`);
    return this.resources.get(key) as T;
  }

  /** 移除資源，回傳是否真的有移除 */
  removeResource(key: ResourceKey<unknown>): boolean {
    return this.resources.delete(key);
  }

  // ───────── 延後執行 ─────────

  /** 排入延後執行，等目前階段的系統都跑完後才執行（適合在走訪中銷毀實體） */
  defer(fn: () => void): void {
    this.deferred.push(fn);
  }

  /** 執行所有延後的指令；指令中再排入的也會一併執行 */
  flush(): void {
    for (let i = 0; i < this.deferred.length; i++) this.deferred[i]();
    this.deferred.length = 0;
  }

  // ───────── 內部 ─────────

  private storeOf<T>(type: ComponentType<T>): ComponentStore<T> {
    let store = this.stores[type.id] as ComponentStore<T> | undefined;
    if (!store) this.stores[type.id] = store = new ComponentStore<T>() as ComponentStore<unknown> as ComponentStore<T>;
    return store;
  }

  private invalidate(componentId: number): void {
    const list = this.queriesByComponent.get(componentId);
    if (list) for (const q of list) q._invalidate();
  }

  private afterRemove(componentId: number, e: Entity, value: unknown): void {
    this.invalidate(componentId);
    const hooks = this.removeHooks.get(componentId);
    if (hooks) for (const hook of [...hooks]) hook(e, value);
  }
}

function subscribe<H>(map: Map<number, Set<H>>, id: number, hook: H): () => void {
  let set = map.get(id);
  if (!set) map.set(id, (set = new Set()));
  set.add(hook);
  return () => set!.delete(hook);
}
