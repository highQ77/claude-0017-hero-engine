/**
 * 全域設定
 */
export interface EngineConfig {
  /** 固定步長（秒），物理與 fixedUpdate 使用。預設 1/60 */
  fixedDelta: number;
  /** 單幀最多補跑幾次 fixedUpdate，避免卡頓後「死亡螺旋」 */
  maxFixedSteps: number;
  /** 單幀時間上限（秒），切換分頁回來時避免一次跳太大 */
  maxDelta: number;
  /** 初始時間縮放 */
  timeScale: number;
  /** 分頁隱藏時自動暫停 */
  pauseOnHidden: boolean;
  /** 除錯模式 */
  debug: boolean;
}

/** 預設的引擎設定 */
export const DEFAULT_CONFIG: Readonly<EngineConfig> = Object.freeze({
  fixedDelta: 1 / 60,
  maxFixedSteps: 5,
  maxDelta: 0.1,
  timeScale: 1,
  pauseOnHidden: true,
  debug: false,
});

/**
 * @param overrides 要改的設定（固定步長、時間縮放、分頁隱藏時暫停…）；其他用預設值
 */
export function createConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  const config: EngineConfig = { ...DEFAULT_CONFIG, ...overrides };
  if (!(config.fixedDelta > 0)) throw new Error('fixedDelta 必須大於 0');
  if (!(config.maxDelta > 0)) throw new Error('maxDelta 必須大於 0');
  if (!(config.maxFixedSteps >= 1)) throw new Error('maxFixedSteps 至少為 1');
  if (!(config.timeScale >= 0)) throw new Error('timeScale 不可為負數');
  return config;
}
