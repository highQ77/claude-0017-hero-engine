/**
 * 計時器：幾秒後做一件事、每隔幾秒做一件事（engine.timers）。
 *
 *   engine.timers.after(2, () => door.open());                 // 2 秒後
 *   const h = engine.timers.every(0.5, () => updateHud());      // 每 0.5 秒；h.cancel() 停止
 *   engine.timers.after(3, respawn, { owner: enemy });          // 綁定實體：實體銷毀時自動取消
 *   engine.timers.every(1, tick, { realtime: true });           // 不受暫停以外的時間縮放影響
 *
 * 和 setTimeout／setInterval 不同：跟著遊戲的主迴圈走——遊戲暫停時不會觸發，
 * 預設也跟著 timeScale（慢動作時一起變慢；timeScale 為 0 時停住）。
 * 在 update 階段最前面觸發（系統、腳本執行之前）。
 */
import { createLogger } from './Logger';

const log = createLogger('timers');

/** 計時器的設定 */
export interface TimerOptions {
  /** 用真實時間（不受 timeScale 影響；暫停時一樣不會觸發） */
  realtime?: boolean;
  /** 擁有者（例如實體）：timers.cancelOwner(擁有者) 一次取消；實體銷毀時 ECS 外掛會自動取消 */
  owner?: unknown;
}

/** every 的設定 */
export interface EveryOptions extends TimerOptions {
  /** 一開始就先執行一次（預設 false：等第一個間隔之後） */
  immediate?: boolean;
}

/** 計時器（after、every 回傳） */
export interface TimerHandle {
  /** 取消（之後不會再觸發；重複呼叫沒關係） */
  cancel(): void;
  /** 還會觸發（沒有取消、after 還沒觸發） */
  readonly active: boolean;
}

interface Entry {
  remaining: number;
  interval: number | null;
  fn: () => void;
  realtime: boolean;
  owner: unknown;
  cancelled: boolean;
}

/** 一幀最多補觸發幾次（卡頓很久時 every 不會一次觸發幾百次） */
const MAX_CATCH_UP = 10;

/**
 * 計時器（engine.timers）：after 幾秒後執行一次、every 每隔幾秒執行。跟著主迴圈：暫停時不觸發、跟著 timeScale。
 * @example
 * engine.timers.after(2, () => door.open());
 */
export class Timers {
  private entries: Entry[] = [];
  private adding: Entry[] = [];

  /** 幾秒後執行一次 */
  after(seconds: number, fn: () => void, options: TimerOptions = {}): TimerHandle {
    if (!(seconds >= 0)) throw new Error(`timers.after：秒數要是 0 以上的數字，收到 ${seconds}`);
    return this.add({ remaining: seconds, interval: null, fn, options });
  }

  /** 每隔幾秒執行一次（直到取消） */
  every(seconds: number, fn: () => void, options: EveryOptions = {}): TimerHandle {
    if (!(seconds > 0)) throw new Error(`timers.every：間隔要大於 0 秒，收到 ${seconds}`);
    const handle = this.add({ remaining: seconds, interval: seconds, fn, options });
    if (options.immediate) this.run(fn);
    return handle;
  }

  /** 取消某個擁有者（例如實體）的所有計時器 */
  cancelOwner(owner: unknown): void {
    for (const e of this.entries) if (e.owner === owner) e.cancelled = true;
    for (const e of this.adding) if (e.owner === owner) e.cancelled = true;
  }

  /** 取消全部 */
  clear(): void {
    for (const e of [...this.entries, ...this.adding]) e.cancelled = true;
    this.entries = [];
    this.adding = [];
  }

  /** 還在等待的計時器數量 */
  get count(): number {
    return [...this.entries, ...this.adding].filter((e) => !e.cancelled).length;
  }

  /**
   * 推進時間（引擎每幀自動呼叫；測試或自己的迴圈也可以呼叫）。
   * delta：遊戲時間（已套用 timeScale）；realDelta：不受 timeScale 影響的時間。
   */
  update(delta: number, realDelta: number = delta): void {
    // 這一幀新增的計時器下一幀才開始算（觸發時又新增的也一樣，不會在同一幀連鎖觸發）
    if (this.adding.length) {
      this.entries.push(...this.adding);
      this.adding = [];
    }
    for (const e of this.entries) {
      if (e.cancelled) continue;
      e.remaining -= e.realtime ? realDelta : delta;
      let fired = 0;
      while (e.remaining <= 1e-9 && !e.cancelled && fired < MAX_CATCH_UP) {
        fired++;
        if (e.interval === null) e.cancelled = true;
        else e.remaining += e.interval;
        this.run(e.fn);
      }
      if (fired >= MAX_CATCH_UP && e.interval !== null && e.remaining <= 0) e.remaining = e.interval;
    }
    this.entries = this.entries.filter((e) => !e.cancelled);
  }

  private add(spec: {
    remaining: number;
    interval: number | null;
    fn: () => void;
    options: TimerOptions;
  }): TimerHandle {
    const entry: Entry = {
      remaining: spec.remaining,
      interval: spec.interval,
      fn: spec.fn,
      realtime: spec.options.realtime ?? false,
      owner: spec.options.owner,
      cancelled: false,
    };
    this.adding.push(entry);
    return {
      cancel: () => {
        entry.cancelled = true;
      },
      get active() {
        return !entry.cancelled;
      },
    };
  }

  /** 執行回呼：出錯時記錄下來，不影響其他計時器 */
  private run(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      log.error('計時器的回呼發生錯誤', error);
    }
  }
}
