import { getWorldPosition, lookAt, rotate, setRotation, updateTransforms } from './Transform';
import {
  expandPrefabs,
  loadSceneFile,
  notifySceneFileChanged,
  parseSceneFile,
  prefabPaths,
  sceneFromFile,
  spawnSceneFile,
  stringifySceneFile,
  writeSceneFile,
} from './SceneFile';
import { stringifySceneXml } from './SceneXml';
export { stringifySceneXml } from './SceneXml';
export { Parent, Hierarchy, HierarchyKey } from './Hierarchy';
export { MeshGeometryKey, SceneCodecsKey } from './keys';
export { Name } from './Name';
export type { MeshGeometrySource } from './keys';
export {
  Transform,
  transformSystem,
  TRANSFORM_PRIORITY,
} from './Transform';
export type { TransformData, TransformComponent } from './Transform';
export { SceneManager, SceneMember } from './SceneManager';
export type { Scene, LoadOptions } from './SceneManager';
export { ScenePlugin } from './ScenePlugin';
export {
  SceneCodecs,
  SCENE_FILE_FORMAT,
  SCENE_FILE_VERSION,
  transformCodec,
  plainCodec,
  registerSceneCodecs,
  registerSceneSettings,
  applySceneSettings,
  parseSceneFile,
  spawnSceneFile,
  writeSceneFile,
  stringifySceneFile,
  sceneFromFile,
  loadSceneFile,
  notifySceneFileChanged,
  readVec3,
  previewScene,
  SCENE_PREVIEW_CHANNEL,
  expandPrefabs,
  prefabPaths,
  prefabRoot,
  tidy,
} from './SceneFile';
export type {
  SceneFileData,
  SceneFileEntity,
  ComponentCodec,
  CodecContext,
  SpawnedScene,
  WriteSceneOptions,
  SceneFromFileOptions,
  PlainCodecOptions,
  ExpandedScene,
  PrefabOverride,
  SceneSettingHandler,
  SettingContext,
  ScenePreviewMessage,
} from './SceneFile';

// ───────── 小工具函式（依用途分類）─────────

/** 數學小工具：朝向、世界座標、向量轉換、緩動曲線（scene 模組的部分；總入口 hero.math 有全部） */
export const math = {
  /** 讓 Transform 的 -Z 方向朝向目標（攝影機、燈光） */
  lookAt: lookAt,
  /** 在自己的座標上旋轉（累加）：math.rotate(t, [0, speed * time.delta, 0])（弧度） */
  rotate: rotate,
  /** 設定旋轉（取代原本的）：math.setRotation(t, [0, Math.PI / 2, 0])（弧度） */
  setRotation: setRotation,
  /** 實體在世界座標的位置（包含父節點） */
  worldPosition: getWorldPosition,
} as const;

/** 立刻更新（平常由外掛每幀自動更新；需要馬上拿到結果時用）（scene 模組的部分；總入口 hero.tick 有全部） */
export const tick = {
  /** 立刻更新所有 Transform 的世界矩陣（平常由場景外掛每幀自動更新） */
  transforms: updateTransforms,
} as const;

/** 建立物件：用場景檔建立場景（scene 模組的部分；總入口 hero.create 有全部） */
export const create = {
  /** 用場景檔建立場景，交給 scenes.register() */
  sceneFromFile: sceneFromFile,
} as const;

/** 載入：下載並檢查場景檔（scene 模組的部分；總入口 hero.load 有全部） */
export const load = {
  /** 下載並檢查場景檔（例如 'scenes/forest.xml'；JSON 也可以） */
  sceneFile: loadSceneFile,
} as const;

/** 場景檔：檢查、建立實體、存檔、轉成文字 */
export const sceneFile = {
  /** 檢查並轉換場景檔內容（JSON 或 XML 文字，或物件） */
  parse: parseSceneFile,
  /** 依場景檔建立實體 */
  spawn: spawnSceneFile,
  /** 把實體存成場景檔 */
  write: writeSceneFile,
  /** 場景檔轉成 JSON 文字 */
  stringify: stringifySceneFile,
  /** 場景檔轉成 XML 文字 */
  stringifyXml: stringifySceneXml,
  /** 展開預製物件 */
  expandPrefabs: expandPrefabs,
  /** 需要哪些預製物件 */
  prefabPaths: prefabPaths,
  /** 通知場景檔改了（開發伺服器會自動呼叫），用到它的場景會重新載入 */
  notifyChanged: notifySceneFileChanged,
} as const;
