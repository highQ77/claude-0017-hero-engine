import { loadBuiltinFont } from './Text3D';
export { Text3D, Text3DController, BUILTIN_FONT } from './Text3D';
export type { Text3DData, Text3DMode, CanvasFactory } from './Text3D';
export { Text3DPlugin } from './Text3DPlugin';
export { text3dCodec } from './sceneCodecs';

// ───────── 小工具函式（依用途分類）─────────

/** 建立物件：文字形狀（text3d 模組的部分；總入口 hero.create 有全部） */
export { create } from './create';

/** 載入：物理引擎、排版引擎、內建字型（外掛建立時會自動載入）（text3d 模組的部分；總入口 hero.load 有全部） */
export const load = {
  /** 載入引擎內建的 3D 文字字型 */
  builtinFont: loadBuiltinFont,
} as const;
