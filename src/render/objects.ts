/**
 * 用描述直接建立 three.js 物件（網格、群組、點雲），遊戲程式不用 import three。
 * 適合「自己組一個模型」交給 SceneObject，或在 Binding、模型動畫裡使用：
 *
 *   const arm = create.mesh({ box: [0.2, 1, 0.2] }, '#ffa94f', { name: 'arm', position: [0, 0.5, 0] });
 *   world.spawn(Transform, SceneObject.with({ object: create.group(arm) }));
 *
 * 和 MeshRenderer 不同：這裡建立的幾何、材質不共用，可以自由修改（用完要自己釋放，或交給 object3d.dispose）。
 */
import * as THREE from 'three';
import {
  type GeometryDesc,
  type MaterialDesc,
  type Vec3Like,
  createGeometry,
  createMaterial,
  toVector3,
} from './descriptors';

/** 物件的位置、旋轉、縮放與名稱 */
export interface ObjectOptions {
  /** 名稱（模型動畫用名稱找到它，例如片段裡的 'arm.position'） */
  name?: string;
  /** 位置 */
  position?: Vec3Like;
  /** 旋轉（弧度，依 X、Y、Z 順序） */
  rotation?: Vec3Like;
  /** 縮放：一個數字（等比例）或 [x, y, z] */
  scale?: number | Vec3Like;
}

/** 套用 ObjectOptions */
function place<T extends THREE.Object3D>(obj: T, o: ObjectOptions = {}): T {
  if (o.name) obj.name = o.name;
  if (o.position) toVector3(o.position, obj.position);
  if (o.rotation) {
    const r = toVector3(o.rotation);
    obj.rotation.set(r.x, r.y, r.z);
  }
  if (o.scale !== undefined) {
    if (typeof o.scale === 'number') obj.scale.setScalar(o.scale);
    else toVector3(o.scale, obj.scale);
  }
  return obj;
}

/** 網格的設定：位置、名稱，加上陰影 */
export interface MeshOptions extends ObjectOptions {
  /** 投射陰影 */
  castShadow?: boolean;
  /** 接收陰影 */
  receiveShadow?: boolean;
}

/**
 * 建立網格：幾何、材質可以是描述（{ box: 1 }、'#f80'）或 three.js 物件。
 * @param geometry 幾何或幾何描述
 * @param material 材質、材質描述，或材質陣列
 * @param options 陰影、名稱、位置、旋轉、縮放
 * @example
 * const head = create.mesh({ sphere: 0.3 }, { standard: { color: '#ffd166' } }, { name: 'head', position: [0, 1.5, 0] });
 */
export function createMesh(
  geometry: GeometryDesc | THREE.BufferGeometry,
  material: MaterialDesc | THREE.Material | THREE.Material[] = '#cccccc',
  options: MeshOptions = {},
): THREE.Mesh {
  const g = geometry instanceof THREE.BufferGeometry ? geometry : createGeometry(geometry);
  const m =
    material instanceof THREE.Material || Array.isArray(material) ? material : createMaterial(material as MaterialDesc);
  const mesh = place(new THREE.Mesh(g, m), options);
  if (options.castShadow) mesh.castShadow = true;
  if (options.receiveShadow) mesh.receiveShadow = true;
  return mesh;
}

/**
 * 建立群組：把好幾個物件包成一個（整個交給 SceneObject，跟著實體移動）。
 * 第一個參數可以是設定（名稱、位置），也可以直接放子物件。
 * @param items 子物件；第一個也可以是設定（名稱、位置、旋轉、縮放）
 * @example
 * const robot = create.group({ name: 'robot' }, body, head, arm);
 */
export function createGroup(...items: (THREE.Object3D | ObjectOptions)[]): THREE.Group {
  const group = new THREE.Group();
  for (const item of items) {
    if (item instanceof THREE.Object3D) group.add(item);
    else place(group, item);
  }
  return group;
}

/** 點雲的設定 */
export interface PointsOptions extends ObjectOptions {
  /** 顏色（沒有 colors 時用） */
  color?: THREE.ColorRepresentation;
  /** 每個點的顏色 [r, g, b, …]（0~1） */
  colors?: readonly number[];
  /** 點的大小（世界單位；sizeAttenuation 為 false 時是像素） */
  size?: number;
  /** 越遠越小（預設 true） */
  sizeAttenuation?: boolean;
  /** 不透明度 */
  opacity?: number;
  /** 重疊方式：'additive' 重疊處變亮（星空、火花） */
  blending?: 'normal' | 'additive';
}

/**
 * 建立點雲：給一串位置（[x, y, z] 的陣列，或攤平的 [x, y, z, x, y, z, …]）。
 * @param positions 位置：[x, y, z] 的陣列，或攤平的 [x, y, z, x, y, z, …]
 * @param options 顏色（或每個點的顏色）、點的大小、是否近大遠小、透明度、混合方式、名稱、位置
 * @example
 * const stars = create.points(Array.from({ length: 500 }, () => [rand(), rand(), rand()]), { color: '#fff', size: 0.05 });
 */
export function createPoints(
  positions: readonly Vec3Like[] | readonly number[],
  options: PointsOptions = {},
): THREE.Points {
  const flat: number[] = [];
  if (typeof positions[0] === 'number') flat.push(...(positions as readonly number[]));
  else for (const p of positions as readonly Vec3Like[]) flat.push(...toVector3(p).toArray());
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
  if (options.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(options.colors as number[], 3));
  const m = new THREE.PointsMaterial({
    color: options.colors ? 0xffffff : (options.color ?? 0xffffff),
    vertexColors: !!options.colors,
    size: options.size ?? 0.05,
    sizeAttenuation: options.sizeAttenuation ?? true,
    transparent: options.opacity !== undefined && options.opacity < 1,
    opacity: options.opacity ?? 1,
    blending: options.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: options.blending !== 'additive',
  });
  return place(new THREE.Points(g, m), options);
}
