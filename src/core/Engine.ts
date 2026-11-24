import { createConfig, type EngineConfig } from './Config';
import { Loop, type Phase, type PhaseCallback, type Scheduler } from './Loop';
import { Time } from './Time';
import { createLogger, setLogLevel } from './Logger';
import { Timers } from './Timers';

const log = createLogger('Engine');
/** 計時器在 update 階段的順序：比所有系統、腳本都早 */
const TIMERS_PRIORITY = -1e9;

/** 引擎狀態：尚未開始、執行中、暫停、已銷毀 */
export type EngineState = 'idle' | 'running' | 'paused' | 'destroyed';

/**
 * 外掛：繪製、物理、輸入、音效等模組都以外掛形式接到引擎上。
 */
export interface Plugin {
  /** 外掛名稱（engine.getPlugin(名稱) 用） */
  readonly name: string;
  /** 依賴的其他外掛名稱，安裝前會檢查 */
  readonly dependencies?: readonly string[];
  /**
   * 安裝時呼叫（engine.use）
   * @param engine 引擎
   */
  install(engine: Engine): void;
  /**
   * 移除時呼叫（engine.removePlugin、engine.destroy）
   * @param engine 引擎
   */
  uninstall?(engine: Engine): void;
}

type EngineEvent = 'start' | 'pause' | 'resume' | 'stop' | 'destroy';
type Listener = () => void;

/** Engine 的設定（固定步長、時間縮放…） */
export interface EngineOptions extends Partial<EngineConfig> {
  /** 測試或非瀏覽器環境可替換排程器 */
  scheduler?: Scheduler;
}

/**
 * 引擎：生命週期（啟動、暫停、恢復、停止、銷毀）與外掛管理。
 */
export class Engine {
  /** 引擎設定 */
  readonly config: EngineConfig;
  /** 時間：delta（每幀秒數）、elapsed（經過時間）、timeScale（時間縮放） */
  readonly time: Time;
  /** 主迴圈（各階段的系統依序執行） */
  readonly loop: Loop;
  /** 計時器：timers.after(秒, 函式)、timers.every(秒, 函式)（暫停時不觸發，跟著 timeScale） */
  readonly timers = new Timers();

  private _state: EngineState = 'idle';
  private readonly plugins = new Map<string, Plugin>();
  private readonly listeners = new Map<EngineEvent, Set<Listener>>();
  private pausedByVisibility = false;

  /**
   * @param options 固定步長、時間縮放、分頁隱藏時暫停、排程器等設定
   */
  constructor(options: EngineOptions = {}) {
    const { scheduler, ...overrides } = options;
    this.config = createConfig(overrides);
    this.time = new Time(this.config.fixedDelta, this.config.timeScale);
    this.loop = new Loop(this.time, {
      maxFixedSteps: this.config.maxFixedSteps,
      maxDelta: this.config.maxDelta,
      scheduler,
    });
    // 計時器在 update 階段最前面觸發（系統、腳本之前）
    this.loop.on('update', (t) => this.timers.update(t.delta, t.unscaledDelta), TIMERS_PRIORITY);
    // 除錯模式：顯示 debug 等級的記錄
    if (this.config.debug) setLogLevel('debug');

    if (this.config.pauseOnHidden && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  /** 目前的狀態 */
  get state(): EngineState {
    return this._state;
  }

  // ───────── 生命週期 ─────────

  /** 開始主迴圈 */
  start(): this {
    this.assertAlive();
    if (this._state !== 'idle') return this;
    this.time._reset();
    this.loop.resetAccumulator();
    this.loop.start();
    this._state = 'running';
    this.emit('start');
    return this;
  }

  /** 暫停（主迴圈停止，畫面停在最後一幀） */
  pause(): this {
    if (this._state !== 'running') return this;
    this.loop.stop();
    this._state = 'paused';
    this.emit('pause');
    return this;
  }

  /** 從暫停恢復 */
  resume(): this {
    if (this._state !== 'paused') return this;
    this.pausedByVisibility = false;
    this.loop.resetAccumulator();
    this.loop.start();
    this._state = 'running';
    this.emit('resume');
    return this;
  }

  /** 停止並回到 idle，之後可再 start() 重新計時 */
  stop(): this {
    if (this._state !== 'running' && this._state !== 'paused') return this;
    this.loop.stop();
    this._state = 'idle';
    this.emit('stop');
    return this;
  }

  /**
   * 暫停時逐幀推進（除錯用），預設推進一個固定步長
   * @param seconds 推進幾秒（預設一個固定步長）
   */
  stepFrame(seconds = this.time.fixedDelta): this {
    this.assertAlive();
    if (this._state === 'running') return this;
    this.loop.step(seconds);
    return this;
  }

  /** 銷毀引擎：停止主迴圈並移除所有外掛 */
  destroy(): void {
    if (this._state === 'destroyed') return;
    this.stop();
    // 反向卸載，讓後裝的（通常依賴前面的）先移除
    for (const name of [...this.plugins.keys()].reverse()) this.removePlugin(name);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.emit('destroy');
    this.listeners.clear();
    this.timers.clear();
    this._state = 'destroyed';
  }

  // ───────── 更新階段 ─────────

  /**
   * 註冊階段回呼，回傳取消註冊函式
   * @param phase 哪個階段：input、fixedUpdate、update、lateUpdate、render
   * @param callback 每幀呼叫的函式
   * @param priority 同階段內的順序：小的先執行
   */
  on(phase: Phase, callback: PhaseCallback, priority = 0): () => void {
    this.assertAlive();
    return this.loop.on(phase, callback, priority);
  }

  // ───────── 外掛 ─────────

  /**
   * 安裝外掛（有依賴關係的要照順序安裝）
   * @param plugin 要安裝的外掛
   */
  use(plugin: Plugin): this {
    this.assertAlive();
    if (this.plugins.has(plugin.name)) {
      throw new Error(`外掛「${plugin.name}」已安裝`);
    }
    for (const dep of plugin.dependencies ?? []) {
      if (!this.plugins.has(dep)) {
        throw new Error(`外掛「${plugin.name}」需要先安裝「${dep}」`);
      }
    }
    plugin.install(this);
    this.plugins.set(plugin.name, plugin);
    this.log(`已安裝外掛：${plugin.name}`);
    return this;
  }

  /**
   * 取得已安裝的外掛（沒有時是 undefined）
   * @param name 外掛名稱
   */
  getPlugin<T extends Plugin>(name: string): T | undefined {
    return this.plugins.get(name) as T | undefined;
  }

  /**
   * 是否安裝了這個外掛
   * @param name 外掛名稱
   */
  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  /**
   * 移除外掛
   * @param name 外掛名稱
   */
  removePlugin(name: string): this {
    const plugin = this.plugins.get(name);
    if (!plugin) return this;
    for (const other of this.plugins.values()) {
      if (other.dependencies?.includes(name)) {
        throw new Error(`無法移除「${name}」：「${other.name}」依賴它`);
      }
    }
    plugin.uninstall?.(this);
    this.plugins.delete(name);
    this.log(`已移除外掛：${name}`);
    return this;
  }

  // ───────── 生命週期事件 ─────────

  /**
   * 監聽引擎事件（start、pause、resume…），回傳取消監聽的函式
   * @param event 事件名稱（start、pause、resume…）
   * @param listener 事件發生時呼叫
   */
  addListener(event: EngineEvent, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => set!.delete(listener);
  }

  // ───────── 內部 ─────────

  private emit(event: EngineEvent): void {
    this.listeners.get(event)?.forEach((fn) => fn());
  }

  private log(message: string): void {
    if (this.config.debug) log.debug(message);
  }

  private assertAlive(): void {
    if (this._state === 'destroyed') throw new Error('引擎已銷毀');
  }

  private onVisibilityChange = (): void => {
    if (document.hidden && this._state === 'running') {
      this.pause();
      this.pausedByVisibility = true;
    } else if (!document.hidden && this.pausedByVisibility) {
      this.resume();
    }
  };
}
