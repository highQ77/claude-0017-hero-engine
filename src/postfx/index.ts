import { defaultPostFxSettings } from './PostProcessingPlugin';
export { PostProcessingPlugin, PostFxKey } from './PostProcessingPlugin';
export type { PostFxSettings, ToneMappingName, AntialiasMode, PassStage } from './PostProcessingPlugin';
export { ColorGradeShader } from './ColorGradeShader';

// ───────── 小工具函式（依用途分類）─────────

/** 建立物件：幾何、材質、貼圖、設定…（postfx 模組的部分；總入口 hero.create 有全部） */
export const create = {
  /** 預設的後製設定 */
  postFxSettings: defaultPostFxSettings,
} as const;
