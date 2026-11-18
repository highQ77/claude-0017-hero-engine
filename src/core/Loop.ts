import type { Time } from './Time';

/**
 * 每幀的更新階段，依此順序執行：
 *   input → fixedUpdate（0~N 次）→ update → lateUpdate → render
 */
export const PHASES = ['input', 'fixedUpdate', 'update', 'lateUpdate', 'render'] as const;
/** 更新階段：input → fixedUpdate → update → lateUpdate → render */
export type Phase = (typeof PHASES)[number];

/** 每個階段呼叫的函式 */
export type PhaseCallback = (time: Time) => void;

interface Handler {
  callback: PhaseCallback;
  priority: number;
  order: number;
}

/** 可替換的排程器，方便測試或在非瀏覽器環境執行 */
export interface Scheduler {
  /** 要求下一幀時呼叫（回傳編號） */
  request(cb: (nowMs: number) => void): number;
  /** 取消 */
  cancel(id: number): void;
  /** 目前時間（毫秒） */
  now(): number;
}

/** 瀏覽器的排程（requestAnimationFrame） */
export const browserScheduler: Scheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
};

/** 主迴圈的設定 */
export interface LoopOptions {
  /** 每幀最多執行幾次固定步長更新（太慢時避免越積越多） */
  maxFixedSteps: number;
  /** 每幀最長的時間（秒；卡頓後不會一次跳太遠） */
  maxDelta: number;
  /** 排程（測試可替換） */
  scheduler?: Scheduler;
}

/**
 * 主迴圈：管理各階段的回呼、固定步長累積器。
 */
export class Loop {
  /** 時間 */
  readonly time: Time;
  private readonly handlers = new Map<Phase, Handler[]>();
  private readonly maxFixedSteps: number;
  private readonly maxDelta: number;
  private readonly scheduler: Scheduler;

  private rafId: number | null = null;
  private lastMs = 0;
  private accumulator = 0;
  private orderCounter = 0;

  constructor(time: Time, options: LoopOptions) {
    this.time = time;
    this.maxFixedSteps = options.maxFixedSteps;
    this.maxDelta = options.maxDelta;
    this.scheduler = options.scheduler ?? browserScheduler;
    for (const phase of PHASES) this.handlers.set(phase, []);
  }

  /** 是否在執行 */
  get running(): boolean {
    return this.rafId !== null;
  }

  /**
   * 註冊某階段的回呼。priority 越小越先執行，同優先度依註冊順序。
   * 回傳取消註冊的函式。
   */
  on(phase: Phase, callback: PhaseCallback, priority = 0): () => void {
    const list = this.handlers.get(phase)!;
    const handler: Handler = { callback, priority, order: this.orderCounter++ };
    list.push(handler);
    list.sort((a, b) => a.priority - b.priority || a.order - b.order);
    return () => {
      const i = list.indexOf(handler);
      if (i !== -1) list.splice(i, 1);
    };
  }

  /** 開始 */
  start(): void {
    if (this.running) return;
    this.lastMs = this.scheduler.now();
    this.rafId = this.scheduler.request(this.tick);
  }

  /** 停止 */
  stop(): void {
    if (this.rafId !== null) this.scheduler.cancel(this.rafId);
    this.rafId = null;
  }

  /** 清掉累積的時間（例如暫停後恢復時呼叫） */
  resetAccumulator(): void {
    this.accumulator = 0;
    this.lastMs = this.scheduler.now();
  }

  /**
   * 手動推進一幀（秒）。暫停時逐幀除錯、或測試時使用。
   */
  step(rawDelta: number): void {
    const time = this.time;
    time.realDelta = Math.max(rawDelta, 0);
    const delta = Math.min(Math.max(rawDelta, 0), this.maxDelta);
    time._advance(delta);

    this.emit('input');

    // 固定步長：依縮放後的時間累積，用固定的 fixedDelta 推進
    this.accumulator += time.delta;
    let steps = 0;
    while (this.accumulator >= time.fixedDelta && steps < this.maxFixedSteps) {
      this.emit('fixedUpdate');
      this.accumulator -= time.fixedDelta;
      steps++;
    }
    // 追不上就丟掉多餘時間，避免越積越多
    if (steps === this.maxFixedSteps && this.accumulator >= time.fixedDelta) {
      this.accumulator %= time.fixedDelta;
    }
    time.alpha = this.accumulator / time.fixedDelta;

    this.emit('update');
    this.emit('lateUpdate');
    this.emit('render');
  }

  private tick = (nowMs: number): void => {
    // 先排下一幀，即使本幀拋出錯誤也不會讓迴圈停住
    this.rafId = this.scheduler.request(this.tick);
    const rawDelta = (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    this.step(rawDelta);
  };

  private emit(phase: Phase): void {
    const list = this.handlers.get(phase)!;
    // 複製一份，回呼中增刪 handler 不會影響本次迭代
    for (const h of list.slice()) h.callback(this.time);
  }
}
