import { entityIndex, type Entity } from './Entity';

/**
 * 元件類型：只描述資料的形狀，行為一律寫在系統裡。
 */
export interface ComponentType<T> {
  /** 元件編號（引擎內部用） */
  readonly id: number;
  /** 元件名稱（除錯、錯誤訊息用） */
  readonly name: string;
  /** 建立一份預設值 */
  readonly create: () => T;
  /**
   * 指定初始值（其他欄位用預設值），給 world.spawn 用：
   * world.spawn(Camera.with({ fov: 50 }), Transform)
   */
  with(init: Partial<T>): readonly [ComponentType<T>, Partial<T>];
}

let nextComponentId = 0;

/**
 * 定義元件。
 * @example
 * const Velocity = define.component('Velocity', () => ({ x: 0, y: 0, z: 0 }));
 */
export function defineComponent<T extends object>(name: string, create: () => T): ComponentType<T> {
  const type: ComponentType<T> = Object.freeze({
    id: nextComponentId++,
    name,
    create,
    with: (init: Partial<T>) => [type, init] as const,
  });
  return type;
}

/** 定義標籤元件（沒有資料，只用來分類，例如 Player、Enemy） */
export function defineTag(name: string): ComponentType<Readonly<Record<string, never>>> {
  const empty = Object.freeze({}) as Readonly<Record<string, never>>;
  return defineComponent(name, () => empty);
}

/**
 * 稀疏集合：dense 陣列連續存放資料，sparse 陣列用實體索引找位置。
 * 新增、刪除、查找都是常數時間，走訪時資料是連續的。
 */
export class ComponentStore<T> {
  /** 有這個元件的實體（和 values 一一對應） */
  readonly entities: Entity[] = [];
  /** 元件資料（和 entities 一一對應） */
  readonly values: T[] = [];
  private readonly sparse: (number | undefined)[] = [];

  /** 數量 */
  get size(): number {
    return this.entities.length;
  }

  /** 這個實體是否有資料 */
  has(e: Entity): boolean {
    const i = this.sparse[entityIndex(e)];
    return i !== undefined && this.entities[i] === e;
  }

  /** 取得實體的資料 */
  get(e: Entity): T | undefined {
    const i = this.sparse[entityIndex(e)];
    return i !== undefined && this.entities[i] === e ? this.values[i] : undefined;
  }

  /** 設定實體的資料 */
  set(e: Entity, value: T): void {
    const index = entityIndex(e);
    const i = this.sparse[index];
    if (i !== undefined && this.entities[i] === e) {
      this.values[i] = value;
      return;
    }
    this.sparse[index] = this.entities.length;
    this.entities.push(e);
    this.values.push(value);
  }

  /** 移除並回傳舊值；不存在時回傳 undefined */
  delete(e: Entity): T | undefined {
    const index = entityIndex(e);
    const i = this.sparse[index];
    if (i === undefined || this.entities[i] !== e) return undefined;
    const value = this.values[i];
    const last = this.entities.length - 1;
    if (i !== last) {
      // 把最後一筆搬到空位，保持陣列連續
      const lastEntity = this.entities[last];
      this.entities[i] = lastEntity;
      this.values[i] = this.values[last];
      this.sparse[entityIndex(lastEntity)] = i;
    }
    this.entities.pop();
    this.values.pop();
    this.sparse[index] = undefined;
    return value;
  }
}
