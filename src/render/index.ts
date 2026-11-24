import {
  createGeometry,
  createMaterial,
  imageTexture,
  loadTexture,
  toVector3,
  type TextureImage,
  type TextureOptions,
  type WrapName,
} from './descriptors';
import { createGroup, createMesh, createPoints } from './objects';
import { BufferAttribute, type TypedArray } from 'three';
export { MeshRenderer, Camera, Light, SceneObject } from './components';
export type { MeshRendererData, CameraData, CameraKind, LightData, LightKind, SceneObjectData } from './components';
export {
  RenderPlugin,
  RenderKey,
  RENDER_SYNC_PRIORITY,
  RENDER_DRAW_PRIORITY,
  ORBIT_CONTROL_PRIORITY,
  isWebGPURenderer,
} from './RenderPlugin';
export { OrbitControl, OrbitController } from './OrbitControls';
export type { OrbitControlData } from './OrbitControls';
export type { RenderOptions, RaycastHit, DrawHandler, EngineRenderer, OverlayCompositor } from './RenderPlugin';
export { Binding, IGNORE_TRANSFORM } from './Binding';
export { RenderResources, registerMaterialType } from './descriptors';
export {
  meshRendererCodec,
  cameraCodec,
  lightCodec,
  renderLayerCodec,
  cameraLayersCodec,
  cameraViewportCodec,
} from './sceneCodecs';
export { RenderLayer, CameraLayers, CameraViewport, LayerNames } from './Layers';
export type { RenderLayerData, CameraLayersData, CameraViewportData } from './Layers';
export { DebugDraw } from './DebugDraw';
export { CameraFollow, CameraShake, CameraRig, shakeCamera } from './CameraRig';
export type { CameraFollowData, CameraShakeData } from './CameraRig';
export type { DebugDrawOptions } from './DebugDraw';
export type {
  BlendingName,
  GeometryDesc,
  MaterialDesc,
  MaterialFactory,
  MaterialOf,
  MaterialParams,
  TextureImage,
  TextureOptions,
  Vec3Like,
  WrapName,
} from './descriptors';
export type { MeshOptions, ObjectOptions, PointsOptions } from './objects';
// 常用的 three.js 型別名稱（只當型別用，例如欄位宣告）：遊戲程式不用 import three
export type {
  BufferGeometry,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Points,
  Texture,
} from 'three';
export { spawn } from './helpers';
export type {
  SpawnCameraOptions,
  SpawnLightOptions,
  SpawnMeshOptions,
  SpawnEntityOptions,
  SpawnCommon,
  SpawnGridOptions,
  DefaultLightsOptions,
} from './helpers';
export { AdaptiveResolution } from './AdaptiveResolution';
export type { AdaptiveResolutionOptions } from './AdaptiveResolution';
export type { BindingSpec } from './Binding';

// ───────── 小工具函式（依用途分類）─────────

/** 建立物件：幾何、材質、貼圖、設定…（render 模組的部分；總入口 hero.create 有全部） */
export const create = {
  /** 用描述建立 three.js 幾何：create.geometry({ box: 1 }) */
  geometry: createGeometry,
  /** 用描述建立 three.js 材質（不共用，可以自由修改）：create.material({ standard: { color: '#f80' } }) 回傳 MeshStandardMaterial */
  material: createMaterial,
  /**
   * 貼圖：給網址就載入（create.texture('textures/wood.png', { repeat: 4 })），
   * 也可以給畫布、圖片、影片（畫布重畫後設定 texture.needsUpdate = true）。pixelated: true 為像素風（放大不模糊）
   * @param source 網址，或畫布、圖片、影片
   * @param options 重複次數、超出範圍時的處理、是否是顏色資料、像素風
   */
  texture: (
    source: string | TextureImage,
    options: {
      /** 重複幾次：數字或 [橫, 縱]；有設定時預設 wrap: 'repeat' */
      repeat?: number | readonly [number, number];
      /** 超出 0～1 時：'repeat' 重複、'clamp' 延伸邊緣、'mirror' 鏡像重複 */
      wrap?: WrapName;
      /** false：不是顏色的資料（法線貼圖、粗糙度貼圖），不做色彩空間轉換；預設 true */
      color?: boolean;
      /** true：像素風，放大時不模糊 */
      pixelated?: boolean;
    } = {},
  ) => {
    const o: TextureOptions = {
      colorSpace: options.color === false ? 'none' : 'srgb',
      repeat:
        options.repeat === undefined
          ? null
          : typeof options.repeat === 'number'
            ? [options.repeat, options.repeat]
            : options.repeat,
      wrap: options.wrap ?? null,
      pixelated: options.pixelated,
    };
    return typeof source === 'string' ? loadTexture(source, o) : imageTexture(source, o);
  },
  /** 網格（three.js 物件，不共用）：create.mesh({ box: 1 }, '#f80', { name: 'arm', position: [0, 1, 0] }) */
  mesh: createMesh,
  /** 群組：create.group({ name: 'robot' }, body, head)，交給 SceneObject 或模型動畫 */
  group: createGroup,
  /** 點雲：create.points([[x, y, z], …], { color: '#fff', size: 0.05 }) */
  points: createPoints,
  /**
   * 幾何的頂點資料（自訂著色器用）：create.attribute(new Float32Array(n * 2), 2)，
   * 再用 geometry.setAttribute('aWeight', …) 加到幾何上；itemSize 是每個頂點幾個數字
   * @param array 頂點資料（例如 new Float32Array(頂點數 × 2)）
   * @param itemSize 每個頂點幾個數字
   * @param normalized 整數資料是否轉成 0~1
   */
  attribute: (array: TypedArray, itemSize: number, normalized = false): BufferAttribute =>
    new BufferAttribute(array, itemSize, normalized),
} as const;

/** 數學小工具：朝向、世界座標、向量轉換、緩動曲線（render 模組的部分；總入口 hero.math 有全部） */
export const math = {
  /** [x, y, z] 或 { x, y, z } 轉成 THREE.Vector3 */
  toVector3: toVector3,
} as const;
