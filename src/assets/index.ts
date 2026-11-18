import { disposeObject3D, instantiate } from './dispose';
import { registerDefaultLoaders } from './loaders';
export { AssetManager, AssetGroup } from './AssetManager';
export type { AssetLoader, AssetType, AssetProgress, ProgressListener, AssetManagerOptions } from './AssetManager';
export type { AssetTypeMap, GLTF, Font } from './types';

export type { DefaultLoaderOptions } from './loaders';

export { Model, ModelController } from './Model';
export type { ModelData, ModelStatus } from './Model';
export { AssetPlugin, AssetsKey, MODEL_PRIORITY } from './AssetPlugin';
export { modelCodec } from './sceneCodecs';
export type { AssetPluginOptions } from './AssetPlugin';

// ───────── 小工具函式（依用途分類）─────────

/** three.js 物件：釋放、複製載入的模型 */
export const object3d = {
  /** 釋放 three.js 物件（含子物件）的幾何、材質、貼圖 */
  dispose: disposeObject3D,
  /** 複製載入的模型（共用幾何與材質） */
  instantiate: instantiate,
} as const;

/** 註冊：內建載入器、著色器片段（assets 模組的部分；總入口 hero.register 有全部） */
export const register = {
  /** 在資源管理器註冊內建的載入器（圖片、音效、glTF…） */
  defaultLoaders: registerDefaultLoaders,
} as const;
