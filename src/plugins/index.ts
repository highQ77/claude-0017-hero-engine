import { computeIntegrity, definePlugin, verifyIntegrity } from './PluginManager';
import { compareVersions, isValidVersion, parseVersion, satisfies } from './semver';
export { PluginManager, PluginContext } from './PluginManager';
export type { PluginPackage, InstalledPlugin, UrlInstallOptions, PluginManagerOptions } from './PluginManager';
export { engineApi, ENGINE_VERSION } from './api';
export type { EngineApi, EngineApiModules } from './api';

// ───────── 小工具函式（依用途分類）─────────

/** 定義：元件、標籤、資源、套件（plugins 模組的部分；總入口 hero.define 有全部） */
export const define = {
  /** 定義套件（有型別檢查） */
  plugin: definePlugin,
} as const;

/** 版本號：比較、檢查、是否符合範圍 */
export const semver = {
  /** 比較兩個版本號 */
  compare: compareVersions,
  /** 是不是合法的版本號 */
  isValid: isValidVersion,
  /** 版本是否符合範圍（例如 ^1.2.0） */
  satisfies: satisfies,
  /** 解析版本號 */
  parse: parseVersion,
} as const;

/** 完整性驗證：從網址安裝套件時確認程式碼沒有被竄改 */
export const integrity = {
  /** 計算程式碼的完整性雜湊（sha384-…） */
  compute: computeIntegrity,
  /** 驗證程式碼的完整性雜湊 */
  verify: verifyIntegrity,
} as const;
