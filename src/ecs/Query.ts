import type { ComponentStore, ComponentType } from './Component';
import type { Entity } from './Entity';

/** 把元件類型清單轉成對應的資料型別清單 */
export type ComponentValues<Cs extends readonly ComponentType<unknown>[]> = {
  -readonly [K in keyof Cs]: Cs[K] extends ComponentType<infer T> ? T : never;
};

/** 查詢的設定 */
export interface QueryOptions {
  /** 排除擁有這些元件的實體 */
  none?: readonly ComponentType<unknown>[];
}

/**
 * 查詢：找出「擁有全部 all 元件、且沒有任何 none 元件」的實體。
 * 結果會快取，只有相關元件增刪時才重算。
 */
export class Query<Cs extends readonly ComponentType<unknown>[]> {
  private cache: Entity[] = [];
  private dirty = true;

  constructor(
    /** 必須有的元件 */
    readonly all: Cs,
    /** 不能有的元件 */
    readonly none: readonly ComponentType<unknown>[],
    private readonly allStores: readonly ComponentStore<unknown>[],
    private readonly noneStores: readonly ComponentStore<unknown>[],
  ) {}

  /** @internal 相關元件變動時由 World 呼叫 */
  _invalidate(): void {
    this.dirty = true;
  }

  /**
   * 符合條件的實體。
   * 重算時會產生新陣列，所以走訪途中增刪實體不會影響正在走訪的這一份。
   */
  get entities(): readonly Entity[] {
    if (this.dirty) this.rebuild();
    return this.cache;
  }

  /** 符合的實體數量 */
  get size(): number {
    return this.entities.length;
  }

  /** 第一個符合的實體（沒有時是 undefined） */
  first(): Entity | undefined {
    return this.entities[0];
  }

  /** 這個實體是否符合 */
  matches(e: Entity): boolean {
    return this.allStores.every((s) => s.has(e)) && !this.noneStores.some((s) => s.has(e));
  }

  /**
   * 走訪每個符合的實體，並直接取得元件資料。
   * 走訪途中已被移除元件或銷毀的實體會自動跳過。
   * @example
   * world.query([Transform, Velocity]).each((e, t, v) => { t.position.x += v.x * dt; });
   */
  each(fn: (entity: Entity, ...values: ComponentValues<Cs>) => void): void {
    const list = this.entities;
    const stores = this.allStores;
    const excluded = this.noneStores;
    const n = stores.length;
    const args: unknown[] = new Array(n + 1);
    const call = fn as (...a: unknown[]) => void;
    outer: for (let k = 0; k < list.length; k++) {
      const e = list[k];
      args[0] = e;
      for (let i = 0; i < n; i++) {
        const v = stores[i].get(e);
        if (v === undefined) continue outer;
        args[i + 1] = v;
      }
      for (let i = 0; i < excluded.length; i++) {
        if (excluded[i].has(e)) continue outer;
      }
      call.apply(undefined, args);
    }
  }

  [Symbol.iterator](): Iterator<Entity> {
    return this.entities[Symbol.iterator]();
  }

  private rebuild(): void {
    // 從最小的集合開始篩，減少比對次數
    let smallest = this.allStores[0];
    for (const s of this.allStores) if (s.size < smallest.size) smallest = s;
    const out: Entity[] = [];
    for (const e of smallest.entities) {
      if (this.matches(e)) out.push(e);
    }
    this.cache = out;
    this.dirty = false;
  }
}
