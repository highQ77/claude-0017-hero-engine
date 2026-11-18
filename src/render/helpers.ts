/**
 * 建立常用實體的小工具：攝影機、燈光、網格，一行完成「建立實體＋Transform＋位置＋朝向」。
 * 都放在 spawn 分類底下：
 *
 *   const camera = spawn.camera(world, { position: [0, 2, 6], target: [0, 0, 0], fov: 50 });
 *   const { ambient, sun } = spawn.defaultLights(world);
 *   const box = spawn.mesh(world, { geometry: { box: 1 }, material: '#9acd32', position: [0, 0.5, 0] });
 *
 *   const tag = spawn.entity(world, { position: [0, 1, 0], parent: box, name: '名牌' }, Text3D.with({ text: 'Hi' }));
 *
 * 都可以給 parent（父節點）、name（名稱，可以用 scripts.find 找）。回傳實體，之後照常用 world.require(實體, Transform) 等操作。
 */
import * as THREE from 'three';
import type { ComponentInit, Entity, World } from '../ecs';
import { HierarchyKey, Name, Parent, Transform, type TransformData } from '../scene';
import { lookAt } from '../scene/Transform';
import {
  Camera,
  Light,
  MeshRenderer,
  SceneObject,
  type CameraData,
  type LightData,
  type MeshRendererData,
} from './components';
import { toVector3, type Vec3Like } from './descriptors';

/** 所有 spawn 共用：父節點、名稱 */
export interface SpawnCommon {
  /** 父節點（位置、旋轉相對於它；父節點銷毀時一起銷毀） */
  parent?: Entity | null;
  /** 名稱（Name 元件；可以用 scripts.find('名稱') 找到） */
  name?: string;
}

interface Placement extends SpawnCommon {
  /** 位置 */
  position?: Vec3Like;
  /** 朝向這一點（攝影機、平行光、聚光燈：讓 -Z 方向對準它） */
  target?: Vec3Like;
}

/** spawn.camera 的設定：攝影機的欄位，加上位置與看向的目標 */
export interface SpawnCameraOptions extends Partial<CameraData>, Placement {}

/** spawn.light 的設定：燈光的欄位，加上位置與照向的目標 */
export interface SpawnLightOptions extends Partial<LightData>, Placement {}

/** spawn.mesh 的設定：網格的欄位，加上位置、旋轉、縮放 */
export interface SpawnMeshOptions extends Partial<MeshRendererData>, SpawnCommon {
  /** 位置 */
  position?: Vec3Like;
  /** 旋轉（弧度，依 X、Y、Z 順序），例如地板 [-Math.PI / 2, 0, 0] */
  rotation?: Vec3Like;
  /** 縮放：一個數字（等比例）或 [x, y, z] */
  scale?: number | Vec3Like;
}

/** spawn.defaultLights 的設定 */
export interface DefaultLightsOptions {
  /** 整體亮度倍率，預設 1 */
  intensity?: number;
  /** 平行光的位置（從這裡照向原點），預設 [3, 6, 4] */
  sun?: Vec3Like;
  /** 平行光投射陰影（RenderPlugin 也要開 shadows），預設 false */
  shadows?: boolean;
}

const _target = new THREE.Vector3();

function place(t: TransformData, o: Placement): void {
  if (o.position) toVector3(o.position, t.position);
  if (o.target) lookAt(t, toVector3(o.target, _target));
}

/** 位置、旋轉（弧度）、縮放 */
function placeTransform(
  t: TransformData,
  o: { position?: Vec3Like; rotation?: Vec3Like; scale?: number | Vec3Like },
): void {
  if (o.position) toVector3(o.position, t.position);
  if (o.rotation) {
    const r = toVector3(o.rotation, _target);
    t.rotation.setFromEuler(new THREE.Euler(r.x, r.y, r.z));
  }
  if (o.scale !== undefined) {
    if (typeof o.scale === 'number') t.scale.setScalar(o.scale);
    else toVector3(o.scale, t.scale);
  }
}

/** 名稱、父節點 */
function applyCommon(world: World, e: Entity, o: SpawnCommon): void {
  if (o.name) world.add(e, Name, { value: o.name });
  if (o.parent !== undefined && o.parent !== null) {
    const hierarchy = world.getResource(HierarchyKey);
    if (hierarchy) hierarchy.setParent(e, o.parent);
    else world.add(e, Parent, { entity: o.parent });
  }
}

/** spawn.entity 的設定：位置、旋轉（弧度，依 X、Y、Z 順序）、縮放、父節點、名稱 */
export interface SpawnEntityOptions extends SpawnCommon {
  /** 位置 */
  position?: Vec3Like;
  /** 旋轉（弧度，依 X、Y、Z 順序） */
  rotation?: Vec3Like;
  /** 縮放：一個數字（等比例）或 [x, y, z] */
  scale?: number | Vec3Like;
}

/** 任意實體：Transform（位置、旋轉、縮放）＋ 父節點、名稱 ＋ 其他元件 */
function spawnEntity(world: World, options: SpawnEntityOptions = {}, ...components: ComponentInit[]): Entity {
  const e = world.spawn(...components);
  placeTransform(world.add(e, Transform), options);
  applyCommon(world, e, options);
  return e;
}

/** 攝影機：預設在 [0, 2, 6] 看向原點 */
function spawnCamera(world: World, options: SpawnCameraOptions = {}): Entity {
  const { position = [0, 2, 6], target = [0, 0, 0], parent, name, ...data } = options;
  const e = world.spawn(Camera.with(data));
  place(world.add(e, Transform), { position, target });
  applyCommon(world, e, { parent, name });
  return e;
}

/** 燈光：kind 預設平行光；平行光、聚光燈有 target 時照向它 */
function spawnLight(world: World, options: SpawnLightOptions = {}): Entity {
  // 半球光的「天空」方向是它的位置（從原點指向光源）：沒有指定時放在正上方，和 three.js 預設一樣
  const { position = options.kind === 'hemisphere' ? [0, 1, 0] : undefined, target, parent, name, ...data } = options;
  const e = world.spawn(Light.with(data));
  place(world.add(e, Transform), { position, target });
  applyCommon(world, e, { parent, name });
  return e;
}

/** 常用的燈光組合：半球光（天空與地面的環境光）＋ 一盞從斜上方照下的平行光 */
function spawnDefaultLights(world: World, options: DefaultLightsOptions = {}): { ambient: Entity; sun: Entity } {
  const k = options.intensity ?? 1;
  const ambient = spawnLight(world, { kind: 'hemisphere', color: 0xcfe0ff, groundColor: 0x40342a, intensity: 1.2 * k });
  const sun = spawnLight(world, {
    kind: 'directional',
    intensity: 2 * k,
    position: options.sun ?? [3, 6, 4],
    target: [0, 0, 0],
    castShadow: options.shadows ?? false,
  });
  return { ambient, sun };
}

/** 網格：幾何、材質可以是描述（{ box: 1 }、'#f80'）或 three.js 物件 */
function spawnMesh(world: World, options: SpawnMeshOptions): Entity {
  const { position, rotation, scale, parent, name, ...data } = options;
  const e = world.spawn(MeshRenderer.with(data));
  placeTransform(world.add(e, Transform), { position, rotation, scale });
  applyCommon(world, e, { parent, name });
  return e;
}

/** spawn.grid 的設定 */
export interface SpawnGridOptions {
  /** 邊長（公尺），預設 10 */
  size?: number;
  /** 格數，預設 10 */
  divisions?: number;
  /** 線的顏色，預設 0x444444 */
  color?: THREE.ColorRepresentation;
  /** 中心十字線的顏色，預設和 color 一樣 */
  centerColor?: THREE.ColorRepresentation;
  /** 位置 */
  position?: Vec3Like;
}

/** 地面格線（除錯、編輯時看位置用） */
function spawnGrid(world: World, options: SpawnGridOptions = {}): Entity {
  const color = options.color ?? 0x444444;
  const grid = new THREE.GridHelper(options.size ?? 10, options.divisions ?? 10, options.centerColor ?? color, color);
  // 格線只是參考線，不參與點選（render.pick）：three.js 的線段射線偵測在 1 公尺內都算打到，
  // 否則點地面上的物件時常常先打到格線
  grid.raycast = () => {};
  const e = world.spawn(SceneObject.with({ object: grid }));
  const t = world.add(e, Transform);
  if (options.position) toVector3(options.position, t.position);
  return e;
}

/**
 * 建立實體的小工具：spawn.camera、spawn.light、spawn.mesh、spawn.defaultLights、spawn.grid，回傳建立的實體。
 *
 *   import * as hero from '@engine';
 *   const camera = hero.spawn.camera(world, { position: [0, 4, 9], target: [0, 0.5, 0], fov: 45 });
 */
export const spawn = {
  /** 任意實體：spawn.entity(world, { position, rotation, scale, parent, name }, ...其他元件)（rotation 是弧度） */
  entity: spawnEntity,
  /** 攝影機：預設在 [0, 2, 6] 看向原點（target） */
  camera: spawnCamera,
  /** 燈光：kind 預設平行光；平行光、聚光燈有 target 時照向它；半球光沒有 position 時天空在正上方 */
  light: spawnLight,
  /** 網格：幾何、材質可以是描述（{ box: 1 }、'#f80'）或 three.js 物件；rotation 是弧度，scale 可以是一個數字 */
  mesh: spawnMesh,
  /** 常用的燈光組合：半球光 + 一盞從斜上方照下的平行光，回傳 { ambient, sun } */
  defaultLights: spawnDefaultLights,
  /** 地面格線：spawn.grid(world, { size: 10, divisions: 10 }) */
  grid: spawnGrid,
} as const;
