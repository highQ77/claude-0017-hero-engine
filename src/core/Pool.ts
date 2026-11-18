/**
 * 物件池：重複使用物件（子彈、特效、敵人…），不用一直建立、銷毀。
 *
 *   const bullets = createPool({
 *     create: () => spawn.mesh(world, { geometry: { sphere: 0.1 }, material: '#ff0' }),
 *     onAcquire: (e) => (world.require(e, MeshRenderer).visible = true),   // 拿出來：顯示、重設
 *     onRelease: (e) => (world.require(e, MeshRenderer).visible = false),  // 放回去：藏起來
 *   });
 *   bullets.prewarm(20);              // 先建立 20 個（避免遊戲中途卡一下）
 *   const b = bullets.acquire();      // 拿一個（池子空了就 create 新的）
 *   bullets.release(b);               // 用完放回去
 *
 * 池子不知道物件的內容：拿出來、放回去時要做的事（顯示、隱藏、重設位置、停用物理…）寫在 onAcquire、onRelease。
 */

/** createPool 的設定 */
export interface PoolOptions<T> {
  /** 建立新物件（池子空了時呼叫） */
  create(): T;
  /** 拿出來時呼叫（重設、顯示） */
  onAcquire?(item: T): void;
  /** 放回去時呼叫（隱藏、停用） */
  onRelease?(item: T): void;
  /** 池子裡最多留幾個閒置的（多的會交給 destroy）；預設不限制 */
  max?: number;
  /** 丟掉物件（超過 max、或 clear 時）；例如 (e) => world.destroy(e) */
  destroy?(item: T): void;
}

/**
 * 物件池：acquire 拿一個（沒有閒置的就建立）、release 放回去重複使用。
 * @example
 * const pool = createPool({ create: () => makeBullet(), onRelease: hide });
 */
export class Pool<T> {
  private readonly idle: T[] = [];
  private readonly used = new Set<T>();

  constructor(private readonly options: PoolOptions<T>) {}

  /** 拿一個物件（有閒置的就用閒置的，沒有就建立新的） */
  acquire(): T {
    const item = this.idle.pop() ?? this.options.create();
    this.used.add(item);
    this.options.onAcquire?.(item);
    return item;
  }

  /** 放回去（不是從這個池子拿出來的、或已經放回去的會被忽略並回傳 false） */
  release(item: T): boolean {
    if (!this.used.delete(item)) return false;
    this.options.onRelease?.(item);
    const max = this.options.max ?? Number.POSITIVE_INFINITY;
    if (this.idle.length < max) this.idle.push(item);
    else this.options.destroy?.(item);
    return true;
  }

  /** 先建立幾個閒置的物件（遊戲開始前做，避免中途建立時卡一下） */
  prewarm(count: number): void {
    for (let i = 0; i < count; i++) {
      const item = this.options.create();
      this.options.onRelease?.(item);
      this.idle.push(item);
    }
  }

  /** 閒置的數量 */
  get free(): number {
    return this.idle.length;
  }

  /** 拿出去還沒放回來的數量 */
  get inUse(): number {
    return this.used.size;
  }

  /** 把所有拿出去的放回來（例如重新開始一關） */
  releaseAll(): void {
    for (const item of [...this.used]) this.release(item);
  }

  /** 清空：閒置的交給 destroy；拿出去的不再追蹤（也交給 destroy） */
  clear(): void {
    for (const item of [...this.idle, ...this.used]) this.options.destroy?.(item);
    this.idle.length = 0;
    this.used.clear();
  }
}

/** 建立物件池 */
export function createPool<T>(options: PoolOptions<T>): Pool<T> {
  return new Pool(options);
}
