/**
 * 動態解析度：依實際的幀時間調整繪製解析度（像素比），讓畫面維持在目標 FPS。
 *
 * - 持續變慢（平均幀時間超過預算 20%，持續 0.5 秒）→ 解析度降 15%
 * - 持續流暢（低於預算的 108%，持續 5 秒）→ 解析度升 10%，直到上限
 * - 升上去後又變慢 → 降回來，並在 20 秒內不再嘗試升高（避免來回震盪）
 *
 * 螢幕通常鎖在 60Hz，達到目標時量到的幀時間就是 16.7ms，看不出還有多少餘裕，
 * 所以採用「穩定一段時間再試著提高」的方式。
 */
export interface AdaptiveResolutionOptions {
  /** 目標 FPS，預設 60 */
  targetFps?: number;
  /** 最低像素比，預設 0.6 */
  minPixelRatio?: number;
  /** 最高像素比，預設為一開始的像素比 */
  maxPixelRatio?: number;
  /** 暖機秒數：剛開始的幾秒（編譯著色器、載入資源）只量測、不調整，預設 3 */
  warmup?: number;
}

/** 動態解析度：畫面跟不上目標 FPS 時降低像素比，流暢時慢慢調回來 */
export class AdaptiveResolution {
  /** 每幀的時間預算（毫秒，例如 60 FPS 是 16.7） */
  readonly budgetMs: number;
  /** 最低的像素比 */
  readonly min: number;
  /** 最高的像素比 */
  readonly max: number;
  private ratio: number;
  private ema = 0;
  private overTime = 0;
  private underTime = 0;
  private cooldown = 0;
  private elapsed = 0;
  private lastAction: 'raise' | 'lower' | null = null;
  private blockRaiseUntil = 0;
  private readonly warmup: number;

  constructor(initialPixelRatio: number, options: AdaptiveResolutionOptions = {}) {
    this.budgetMs = 1000 / (options.targetFps ?? 60);
    this.max = options.maxPixelRatio ?? initialPixelRatio;
    this.min = Math.min(options.minPixelRatio ?? 0.6, this.max);
    this.ratio = Math.min(this.max, Math.max(this.min, initialPixelRatio));
    this.warmup = options.warmup ?? 3;
  }

  /** 目前的像素比 */
  get pixelRatio(): number {
    return this.ratio;
  }

  /** 平滑後的幀時間（毫秒） */
  get averageFrameMs(): number {
    return this.ema;
  }

  /**
   * 每幀呼叫（真實的幀間隔，秒）。需要調整時回傳新的像素比，否則回傳 null。
   */
  update(realDelta: number): number | null {
    const ms = realDelta * 1000;
    // 暫停、切換分頁、載入造成的單次長停頓不列入判斷
    if (ms <= 0 || ms > 250) return null;
    this.elapsed += realDelta;
    this.ema = this.ema === 0 ? ms : this.ema * 0.9 + ms * 0.1;
    if (this.elapsed < this.warmup) return null; // 暖機中：只量測
    if (this.cooldown > 0) {
      this.cooldown -= realDelta;
      return null;
    }

    if (this.ema > this.budgetMs * 1.2) {
      this.overTime += realDelta;
      this.underTime = 0;
    } else if (this.ema < this.budgetMs * 1.08) {
      this.underTime += realDelta;
      this.overTime = 0;
    } else {
      this.overTime = this.underTime = 0;
    }

    if (this.overTime >= 0.5 && this.ratio > this.min) {
      // 剛升高就變慢：這個解析度撐不住，暫時不要再升
      if (this.lastAction === 'raise') this.blockRaiseUntil = this.elapsed + 20;
      return this.apply(Math.max(this.min, this.ratio * 0.85), 'lower');
    }
    if (this.underTime >= 5 && this.ratio < this.max && this.elapsed >= this.blockRaiseUntil) {
      return this.apply(Math.min(this.max, this.ratio * 1.1), 'raise');
    }
    return null;
  }

  private apply(ratio: number, action: 'raise' | 'lower'): number {
    this.ratio = Math.round(ratio * 100) / 100;
    this.lastAction = action;
    this.overTime = this.underTime = 0;
    this.cooldown = action === 'lower' ? 1 : 1.5; // 等新解析度穩定再判斷
    this.ema = this.budgetMs; // 重新量測
    return this.ratio;
  }
}
