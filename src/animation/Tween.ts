import type { Entity, World } from '../ecs';
import { resolveEasing, type EasingFn, type EasingName } from './Easing';

/** 可補間的目標：任何擁有數字屬性的物件（例如 Vector3、Color、材質） */
type NumericKeys<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];
/** 可以補間的欄位：物件裡數字型別的屬性（例如 { x: 1, y: 2 }） */
export type TweenProps<T> = Partial<Pick<T, NumericKeys<T>>>;

/** 補間的設定 */
export interface TweenOptions {
  /** 秒 */
  duration: number;
  /** 預設 quadOut */
  easing?: EasingName | EasingFn;
  /** 延遲（秒），相對於前一步結束（或 at 指定的時間點） */
  delay?: number;
}

/** 時間軸上一段補間的設定 */
export interface StepOptions extends TweenOptions {
  /**
   * 這一步從何時開始：
   * - 省略：前一步結束後
   * - '<'：和前一步同時開始
   * - 數字：時間軸上的絕對秒數
   */
  at?: number | '<';
}

/** 播放的設定 */
export interface PlayOptions {
  /** 重複次數（不含第一次），Infinity 為無限 */
  repeat?: number;
  /** 重複時來回播放 */
  yoyo?: boolean;
  /** 不受時間縮放影響（適合介面動畫） */
  unscaled?: boolean;
  /** 綁定實體：實體銷毀時自動停止 */
  entity?: Entity;
  /** 每一幀更新後呼叫 */
  onUpdate?: () => void;
  /** 播完時呼叫 */
  onComplete?: () => void;
}

interface TweenStep {
  kind: 'tween';
  start: number;
  duration: number;
  target: Record<string, number>;
  to: Record<string, number>;
  /** 指定的起始值；null 代表開始時讀取目前數值 */
  fixedFrom: Record<string, number> | null;
  easing: EasingFn;
}

interface CallStep {
  kind: 'call';
  start: number;
  fn: () => void;
}

type Step = TweenStep | CallStep;

/**
 * 時間軸：把多個補間與呼叫排在一起。
 * @example
 * const tl = new Timeline()
 *   .to(t.scale, { x: 1.5, y: 1.5, z: 1.5 }, { duration: 0.1 })
 *   .to(t.scale, { x: 1, y: 1, z: 1 }, { duration: 0.3, easing: 'elasticOut' })
 *   .to(mat, { opacity: 0 }, { duration: 0.3, at: '<' })   // 和上一步同時
 *   .call(() => console.log('done'));
 * tweens.play(tl);
 */
export class Timeline {
  /** @internal */
  readonly steps: Step[] = [];
  private end = 0;
  private lastStart = 0;

  /** 總長度（秒） */
  get duration(): number {
    return this.end;
  }

  /** 從目前數值補間到 props */
  to<T extends object>(target: T, props: TweenProps<T>, options: StepOptions): this {
    return this.addTween(target, null, props, options);
  }

  /** 從 from 補間到 to */
  fromTo<T extends object>(target: T, from: TweenProps<T>, to: TweenProps<T>, options: StepOptions): this {
    return this.addTween(target, from, to, options);
  }

  /** 等待一段時間 */
  wait(seconds: number): this {
    this.end += Math.max(0, seconds);
    this.lastStart = this.end;
    return this;
  }

  /** 在此時呼叫函式 */
  call(fn: () => void, at?: number | '<'): this {
    const start = this.startOf(at, 0);
    this.steps.push({ kind: 'call', start, fn });
    this.lastStart = start;
    this.end = Math.max(this.end, start);
    return this;
  }

  private addTween(target: object, from: object | null, to: object, options: StepOptions): this {
    if (!(options.duration >= 0)) throw new Error('duration 不可為負數');
    for (const [key, value] of Object.entries(to)) {
      if (typeof value !== 'number') throw new Error(`屬性「${key}」不是數字`);
    }
    const start = this.startOf(options.at, options.delay ?? 0);
    this.steps.push({
      kind: 'tween',
      start,
      duration: options.duration,
      target: target as Record<string, number>,
      to: { ...(to as Record<string, number>) },
      fixedFrom: from ? { ...(from as Record<string, number>) } : null,
      easing: resolveEasing(options.easing),
    });
    this.lastStart = start;
    this.end = Math.max(this.end, start + options.duration);
    return this;
  }

  private startOf(at: number | '<' | undefined, delay: number): number {
    if (at === '<') return this.lastStart + delay;
    if (typeof at === 'number') return at + delay;
    return this.end + delay;
  }
}

/** 補間狀態：播放中、暫停、播完、被停止 */
export type TweenState = 'playing' | 'paused' | 'completed' | 'stopped';

/** 同一個物件的同一個屬性，依開始時間排序的補間步驟 */
interface Track {
  target: Record<string, number>;
  key: string;
  steps: TweenStep[];
  /** 每一步的起始值（第一次被驅動時才決定） */
  from: number[] | null;
}

/**
 * 播放中的補間（或時間軸）。
 * 可以用 await tween.finished 串接：完成時為 true，被中途停止時為 false。
 * 開始播放後請勿再修改它的 Timeline。
 */
export class Tween {
  /** 播完時完成的 Promise（被停止時結果是 false） */
  readonly finished: Promise<boolean>;
  private _state: TweenState = 'playing';
  private elapsed = 0;
  private iteration = 0;
  private readonly tracks: Track[] = [];
  private readonly calls: CallStep[];
  private readonly firedCalls = new Set<CallStep>();
  private resolve!: (completed: boolean) => void;

  constructor(
    /** 播放的時間軸 */
    readonly timeline: Timeline,
    /** 播放的設定 */
    readonly options: PlayOptions = {},
  ) {
    this.finished = new Promise((r) => (this.resolve = r));
    const byTarget = new Map<object, Map<string, Track>>();
    for (const step of timeline.steps) {
      if (step.kind !== 'tween') continue;
      let keys = byTarget.get(step.target);
      if (!keys) byTarget.set(step.target, (keys = new Map()));
      for (const key in step.to) {
        let track = keys.get(key);
        if (!track) {
          keys.set(key, (track = { target: step.target, key, steps: [], from: null }));
          this.tracks.push(track);
        }
        track.steps.push(step);
      }
    }
    for (const track of this.tracks) track.steps.sort((a, b) => a.start - b.start); // 穩定排序
    this.calls = timeline.steps.filter((s): s is CallStep => s.kind === 'call').sort((a, b) => a.start - b.start);
  }

  /** 目前的狀態 */
  get state(): TweenState {
    return this._state;
  }

  /** 是否還在播放（播放中或暫停） */
  get active(): boolean {
    return this._state === 'playing' || this._state === 'paused';
  }

  /** 暫停 */
  pause(): this {
    if (this._state === 'playing') this._state = 'paused';
    return this;
  }

  /** 繼續播放 */
  resume(): this {
    if (this._state === 'paused') this._state = 'playing';
    return this;
  }

  /** 停止；jumpToEnd 為 true 時先跳到最終狀態 */
  stop(jumpToEnd = false): void {
    if (!this.active) return;
    if (jumpToEnd) {
      this.applyAt(this.finalTime());
      if (!this.active) return;
      this.finish('completed');
    } else {
      this.finish('stopped');
    }
  }

  /** 是否作用在這個物件上 */
  targets(target: object): boolean {
    return this.tracks.some((t) => t.target === target);
  }

  /** @internal 推進時間，回傳是否已結束 */
  _advance(dt: number): boolean {
    if (this._state === 'paused') return false;
    if (!this.active) return true;
    const duration = this.timeline.duration;
    const repeat = this.options.repeat ?? 0;

    if (duration === 0) {
      // 長度為 0：直接套用結果並結束（無限重複也只跑一次）
      this.applyAt(0);
      if (this.active) {
        this.options.onUpdate?.();
        this.finish('completed');
      }
      return true;
    }

    this.elapsed += dt;
    // 一次 dt 可能跨過好幾輪
    while (this.elapsed >= duration) {
      this.applyAt(this.directional(duration));
      if (!this.active) return true; // 回呼中被停止
      if (this.iteration >= repeat) {
        this.options.onUpdate?.();
        this.finish('completed');
        return true;
      }
      this.iteration++;
      this.elapsed -= duration;
      this.firedCalls.clear();
    }
    this.applyAt(this.directional(this.elapsed));
    if (this.active) this.options.onUpdate?.();
    return !this.active;
  }

  /** yoyo 的奇數輪倒著播放 */
  private directional(t: number): number {
    return this.options.yoyo && this.iteration % 2 === 1 ? this.timeline.duration - t : t;
  }

  private finalTime(): number {
    const repeat = this.options.repeat ?? 0;
    const endsReversed = this.options.yoyo && Number.isFinite(repeat) && repeat % 2 === 1;
    return endsReversed ? 0 : this.timeline.duration;
  }

  private applyAt(t: number): void {
    // 呼叫只在正向播放經過時觸發
    if (!(this.options.yoyo && this.iteration % 2 === 1)) {
      for (const call of this.calls) {
        if (call.start > t) break;
        if (this.firedCalls.has(call)) continue;
        this.firedCalls.add(call);
        call.fn();
        if (!this.active) return;
      }
    }

    for (const track of this.tracks) {
      // 找出此刻負責這個屬性的步驟：最後一個已開始的
      let i = -1;
      for (let j = 0; j < track.steps.length && track.steps[j].start <= t; j++) i = j;
      if (i === -1) {
        // 都還沒開始：若曾經開始過（倒播或重複），回到第一步的起始值；否則不碰它
        if (!track.from) continue;
        i = 0;
      }
      if (!track.from) {
        // 第一次驅動：決定每一步的起始值，後一步接續前一步的終點
        track.from = track.steps.map(
          (step, k) =>
            step.fixedFrom?.[track.key] ?? (k === 0 ? track.target[track.key] : track.steps[k - 1].to[track.key]),
        );
      }
      const step = track.steps[i];
      const from = track.from[i];
      const p =
        step.duration === 0 ? (t >= step.start ? 1 : 0) : Math.min(1, Math.max(0, (t - step.start) / step.duration));
      track.target[track.key] = from + (step.to[track.key] - from) * step.easing(p);
    }
  }

  private finish(state: 'completed' | 'stopped'): void {
    this._state = state;
    if (state === 'completed') this.options.onComplete?.();
    this.resolve(state === 'completed');
  }
}

/**
 * 補間管理：建立、更新、停止補間。
 * 透過 world.requireResource(TweensKey) 在系統中取得。
 */
export class TweenManager {
  private active: Tween[] = [];
  /** update() 走訪中的清單（讓回呼裡的 killTweensOf 也找得到） */
  private updating: Tween[] = [];

  constructor(private readonly world: World | null = null) {}

  /** 正在播放的補間數量 */
  get count(): number {
    return this.active.length;
  }

  /**
   * 從目前數值補間到 props。
   * @example
   * tweens.to(t.position, { y: 2 }, { duration: 0.5, easing: 'backOut', entity: e });
   */
  to<T extends object>(target: T, props: TweenProps<T>, options: TweenOptions & PlayOptions): Tween {
    return this.play(new Timeline().to(target, props, options), options);
  }

  /** 從指定的起始值補間到目標值 */
  fromTo<T extends object>(
    target: T,
    from: TweenProps<T>,
    to: TweenProps<T>,
    options: TweenOptions & PlayOptions,
  ): Tween {
    return this.play(new Timeline().fromTo(target, from, to, options), options);
  }

  /** 等待一段遊戲時間：await tweens.delay(1) */
  delay(seconds: number, options: PlayOptions = {}): Tween {
    return this.play(new Timeline().wait(seconds), options);
  }

  /** 建立時間軸：.to().to() 串接多段動畫，用 tweens.play() 播放 */
  timeline(): Timeline {
    return new Timeline();
  }

  /** 播放時間軸 */
  play(timeline: Timeline, options: PlayOptions = {}): Tween {
    const tween = new Tween(timeline, options);
    this.active.push(tween);
    return tween;
  }

  /** 停止所有作用在 target 上的補間 */
  killTweensOf(target: object, jumpToEnd = false): void {
    for (const t of [...this.active, ...this.updating]) if (t.targets(target)) t.stop(jumpToEnd);
  }

  /** 停止所有補間 */
  stopAll(): void {
    for (const t of [...this.active.splice(0), ...this.updating]) t.stop();
  }

  /** 每幀呼叫 */
  update(delta: number, unscaledDelta: number = delta): void {
    if (this.active.length === 0) return;
    const list = (this.updating = this.active);
    this.active = [];
    for (const tween of list) {
      const entity = tween.options.entity;
      if (entity !== undefined && this.world && !this.world.isAlive(entity)) {
        tween.stop();
        continue;
      }
      const done = tween._advance(tween.options.unscaled ? unscaledDelta : delta);
      if (!done) this.active.push(tween);
    }
    this.updating = [];
    // 更新途中新建立的補間（例如在 onComplete 裡）會由 play() 直接加進 this.active
  }
}
