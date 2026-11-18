import type { BufferGeometry, ColorRepresentation, Material, Object3D } from 'three';
import { defineComponent } from '../ecs/Component';
import type { GeometryDesc, MaterialDesc } from './descriptors';

/**
 * 網格：幾何與材質。
 * - 寫描述（例如 geometry: { box: 1 }、material: { standard: { color: '#f80' } }）：繪製外掛建立、共用、自動釋放
 * - 給 three.js 物件：視為共用資源，移除元件時不會自動釋放（交給資源管理處理）
 * 實際的 three.js 物件可以用 render.getObject(實體) 取得。
 */
export interface MeshRendererData {
  /** 幾何：描述（{ box: 1 }）或 three.js 幾何 */
  geometry: BufferGeometry | GeometryDesc | null;
  /** 材質：描述（'#f80'、{ standard: {...} }）或 three.js 材質（多個材質時給陣列） */
  material: Material | Material[] | MaterialDesc | null;
  /** 投射陰影 */
  castShadow: boolean;
  /** 接收陰影 */
  receiveShadow: boolean;
  /** 是否顯示 */
  visible: boolean;
  /** 繪製順序（數字大的後畫；半透明物件排序用） */
  renderOrder: number;
}

/** 網格元件：把幾何與材質畫在實體的位置（通常用 spawn.mesh 建立） */
export const MeshRenderer = defineComponent<MeshRendererData>('MeshRenderer', () => ({
  geometry: null,
  material: null,
  castShadow: false,
  receiveShadow: false,
  visible: true,
  renderOrder: 0,
}));

/** 攝影機種類：透視（有遠近感）或正交（沒有遠近感，2D、等角視角用） */
export type CameraKind = 'perspective' | 'orthographic';

/**
 * 攝影機：朝向為自身的 -Z 方向（可用 spawn.camera 的 target 或 math.lookAt() 設定）。
 * 場上有多台時，啟用中且 priority 最高的那台負責繪製。
 */
export interface CameraData {
  /** 攝影機種類（預設 perspective） */
  kind: CameraKind;
  /** 透視攝影機的垂直視角（度） */
  fov: number;
  /** 最近能看到的距離 */
  near: number;
  /** 最遠能看到的距離 */
  far: number;
  /** 正交攝影機的可視半高（世界單位） */
  size: number;
  /** 縮放（正交攝影機拉近拉遠用） */
  zoom: number;
  /** 優先度：有多台攝影機時，最高的負責繪製 */
  priority: number;
  /** 是否啟用（停用的不會被選為繪製用的攝影機） */
  enabled: boolean;
}

/** 攝影機元件（通常用 spawn.camera 建立） */
export const Camera = defineComponent<CameraData>('Camera', () => ({
  kind: 'perspective',
  fov: 60,
  near: 0.1,
  far: 1000,
  size: 5,
  zoom: 1,
  priority: 0,
  enabled: true,
}));

/** 燈光種類：環境光、半球光、平行光、點光源、聚光燈 */
export type LightKind = 'ambient' | 'hemisphere' | 'directional' | 'point' | 'spot';

/**
 * 燈光：平行光與聚光燈照向自身的 -Z 方向。
 * 環境光與半球光不受變換影響。
 */
export interface LightData {
  /** 燈光種類（預設 directional 平行光） */
  kind: LightKind;
  /** 顏色 */
  color: ColorRepresentation;
  /** 亮度 */
  intensity: number;
  /** 半球光的地面顏色 */
  groundColor: ColorRepresentation;
  /** 點光源、聚光燈的照射距離，0 代表無限 */
  distance: number;
  /** 點光源、聚光燈：距離衰減的程度（2 為物理正確） */
  decay: number;
  /** 聚光燈角度（弧度） */
  angle: number;
  /** 聚光燈邊緣柔和度 0~1 */
  penumbra: number;
  /** 投射陰影（RenderPlugin 也要開啟 shadows） */
  castShadow: boolean;
  /** 陰影貼圖解析度 */
  shadowMapSize: number;
  /** 平行光陰影涵蓋的範圍（世界單位，正方形邊長） */
  shadowArea: number;
}

/** 燈光元件（通常用 spawn.light 建立） */
export const Light = defineComponent<LightData>('Light', () => ({
  kind: 'directional',
  color: 0xffffff,
  intensity: 1,
  groundColor: 0x444444,
  distance: 0,
  decay: 2,
  angle: Math.PI / 6,
  penumbra: 0.2,
  castShadow: false,
  shadowMapSize: 1024,
  shadowArea: 20,
}));

/**
 * 任意 three.js 物件（例如載入的模型、粒子、文字）。
 * 物件由建立者負責釋放，移除元件時只會從場景中拿掉。
 */
export interface SceneObjectData {
  /** 要放進場景的 three.js 物件（載入的模型、自己組的群組…） */
  object: Object3D | null;
  /** 是否顯示 */
  visible: boolean;
}

/** 任意 three.js 物件元件：物件跟著實體的 Transform 移動 */
export const SceneObject = defineComponent<SceneObjectData>('SceneObject', () => ({
  object: null,
  visible: true,
}));
