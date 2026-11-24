/**
 * 實體：只是一個編號，本身不含資料。
 * 編號 = 世代 × 2^22 + 索引。實體銷毀後索引會回收，但世代加一，
 * 所以舊編號不會誤指到新實體。
 */
export type Entity = number & { readonly __brand: 'Entity' };

const INDEX_LIMIT = 2 ** 22; // 最多約 419 萬個同時存在的實體

/** 代表「沒有實體」 */
export const NULL_ENTITY = -1 as Entity;

/**
 * @param e 實體
 */
export function entityIndex(e: Entity): number {
  return e % INDEX_LIMIT;
}

/**
 * @param e 實體
 */
export function entityGeneration(e: Entity): number {
  return Math.floor(e / INDEX_LIMIT);
}

export class EntityPool {
  private readonly generations: number[] = [];
  private readonly free: number[] = [];
  readonly alive = new Set<Entity>();

  create(): Entity {
    let index: number;
    if (this.free.length > 0) {
      index = this.free.pop()!;
    } else {
      index = this.generations.length;
      if (index >= INDEX_LIMIT) throw new Error('實體數量超過上限');
      this.generations.push(0);
    }
    const e = (this.generations[index] * INDEX_LIMIT + index) as Entity;
    this.alive.add(e);
    return e;
  }

  isAlive(e: Entity): boolean {
    return this.alive.has(e);
  }

  release(e: Entity): boolean {
    if (!this.alive.delete(e)) return false;
    const index = entityIndex(e);
    this.generations[index]++;
    this.free.push(index);
    return true;
  }
}
