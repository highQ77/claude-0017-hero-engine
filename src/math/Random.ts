/**
 * 可以重現的亂數：給同一個種子，每次得到同樣的一串數字（關卡產生、多人連線同步、可以重現的測試）。
 *
 *   const rng = new Random(42);        // 或 new Random('level-3')
 *   rng.next();                         // 0 ≤ x < 1
 *   rng.range(-5, 5);                   // -5 ≤ x < 5
 *   rng.int(1, 6);                      // 骰子：1~6（包含 6）
 *   rng.chance(0.25);                   // 25% 的機會是 true
 *   rng.pick(['紅', '綠', '藍']);
 *   rng.shuffle(cards);                 // 打亂（直接改這個陣列）
 *
 * 不給種子時用隨機的種子（和 Math.random 一樣每次不同，但仍然可以讀 seed 記下來重現）。
 * 演算法：mulberry32（快、品質夠遊戲用；不適合密碼、抽獎等安全用途）。
 */

/** 文字種子轉成數字（FNV-1a） */
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 可以重現的亂數：同一個種子每次得到一樣的結果。
 * @example
 * const rng = new Random(42);
 * rng.int(1, 6); // 骰子
 */
export class Random {
  /** 種子（數字；文字種子會轉成數字） */
  readonly seed: number;
  private state: number;

  constructor(seed?: number | string) {
    const s =
      seed === undefined ? Math.floor(Math.random() * 2 ** 32) : typeof seed === 'string' ? hashSeed(seed) : seed;
    if (!Number.isFinite(s)) throw new Error(`Random：種子要是數字或文字，收到 ${seed}`);
    this.seed = s >>> 0;
    this.state = this.seed;
  }

  /** 0 ≤ x < 1 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** min ≤ x < max */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** 整數 min ≤ x ≤ max（包含兩端） */
  int(min: number, max: number): number {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** 機率 p（0~1）時是 true */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** 1 或 -1 */
  sign(): 1 | -1 {
    return this.next() < 0.5 ? -1 : 1;
  }

  /** 從陣列裡隨機選一個（空陣列時丟出錯誤） */
  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error('Random.pick：陣列是空的');
    return items[Math.floor(this.next() * items.length)];
  }

  /** 依權重選一個：rng.weighted([['普通', 80], ['稀有', 15], ['傳說', 5]]) */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
    if (!(total > 0)) throw new Error('Random.weighted：權重的總和要大於 0');
    let r = this.next() * total;
    for (const [item, w] of entries) {
      r -= Math.max(0, w);
      if (r < 0) return item;
    }
    return entries[entries.length - 1][0];
  }

  /** 打亂陣列（直接改這個陣列，也回傳它） */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /** 分出一個新的亂數產生器（同一個種子分出來的也一樣），讓不同用途互不影響 */
  fork(): Random {
    return new Random(Math.floor(this.next() * 2 ** 32));
  }
}
