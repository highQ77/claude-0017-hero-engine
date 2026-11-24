/**
 * 時間：每幀間隔、固定步長、時間縮放
 * 由 Loop 負責推進，遊戲程式只讀取。
 */
export class Time {
  /** 本幀間隔（秒，已套用時間縮放） */
  delta = 0;
  /** 本幀間隔（秒，未套用時間縮放，適合介面動畫） */
  unscaledDelta = 0;
  /**
   * 真實的幀間隔（秒）：不受時間縮放影響，也不受 maxDelta 限制。
   * 卡頓時會很大，適合效能量測；遊戲邏輯請用 delta。
   */
  realDelta = 0;
  /** 遊戲經過時間（秒，已套用時間縮放） */
  elapsed = 0;
  /** 實際經過時間（秒，未套用時間縮放） */
  unscaledElapsed = 0;
  /** 已執行的幀數 */
  frame = 0;
  /** 固定步長（秒） */
  readonly fixedDelta: number;
  /**
   * 固定步長的插值比例 0~1。
   * 繪製時可用來在上一次與這一次物理狀態之間插值，讓畫面平滑。
   */
  alpha = 0;
  /** 平滑後的每秒幀數 */
  fps = 0;

  private _timeScale: number;

  /**
   * @param fixedDelta 固定步長（秒）
   * @param timeScale 時間縮放（1 正常）
   */
  constructor(fixedDelta: number, timeScale: number) {
    this.fixedDelta = fixedDelta;
    this._timeScale = timeScale;
  }

  /** 時間縮放（1 正常、0.5 慢動作、0 停止；不影響 realDelta） */
  get timeScale(): number {
    return this._timeScale;
  }

  set timeScale(value: number) {
    if (!(value >= 0)) throw new Error('timeScale 不可為負數');
    this._timeScale = value;
  }

  /** @internal 由 Loop 呼叫 */
  _advance(rawDelta: number): void {
    this.unscaledDelta = rawDelta;
    this.delta = rawDelta * this._timeScale;
    this.unscaledElapsed += rawDelta;
    this.elapsed += this.delta;
    this.frame++;
    if (rawDelta > 0) {
      const instant = 1 / rawDelta;
      this.fps = this.fps === 0 ? instant : this.fps * 0.9 + instant * 0.1;
    }
  }

  /** @internal */
  _reset(): void {
    this.delta = this.unscaledDelta = this.realDelta = 0;
    this.elapsed = this.unscaledElapsed = 0;
    this.frame = 0;
    this.alpha = 0;
    this.fps = 0;
  }
}
