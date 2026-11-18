import { createConfig } from './Config';
import { createLogger } from './Logger';
import { createPool } from './Pool';
import { createSave } from './Save';
export { Engine } from './Engine';
export type { EngineState, EngineOptions, Plugin } from './Engine';
export { Time } from './Time';
export { Loop, PHASES, browserScheduler } from './Loop';
export type { Phase, PhaseCallback, Scheduler, LoopOptions } from './Loop';
export { DEFAULT_CONFIG } from './Config';
export type { EngineConfig } from './Config';

// ───────── 小工具函式（依用途分類）─────────

/** 建立物件：幾何、材質、貼圖、設定…（core 模組的部分；總入口 hero.create 有全部） */
export const create = {
  /** 建立引擎設定（未指定的欄位用預設值） */
  config: createConfig,
  /** 建立一個模組的記錄器：create.logger('physics').warn('…') */
  logger: createLogger,
  /** 建立物件池：create.pool({ create, onAcquire, onRelease }) */
  pool: createPool,
  /** 建立存檔：create.save({ name: 'my-game', version: 1 }) */
  save: createSave,
} as const;
export { ENGINE_VERSION } from './version';
export { Timers } from './Timers';
export type { TimerHandle, TimerOptions, EveryOptions } from './Timers';
export { createLogger, setLogLevel, getLogLevel, onLog } from './Logger';
export type { Logger, LogEntry, LogLevel } from './Logger';
export { Pool, createPool } from './Pool';
export type { PoolOptions } from './Pool';
export { SaveFile, SaveError, createSave, memoryStorage } from './Save';
export type { SaveOptions, SaveInfo, SaveStorage } from './Save';
