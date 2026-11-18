/**
 * 幾何與材質的「描述」：遊戲程式只寫資料，由繪製外掛轉成 three.js 物件。
 *
 *   MeshRenderer.with({
 *     geometry: { box: [1, 2, 1] },
 *     material: { standard: { color: '#ffb347', roughness: 0.4 } },
 *   })
 *
 * 好處：
 * - 遊戲程式不用 import three.js（以後換繪製技術只要改這裡）
 * - 內容一樣的描述共用同一份幾何、材質（例如 100 個一樣的箱子只有一份材質）
 * - 沒有實體在用時自動釋放（不用自己呼叫 dispose()）
 * - 描述是一般資料，可以寫進場景檔、存檔
 *
 * 需要特別的東西（自訂著色器、載入的模型、貼圖）時，照樣直接給 three.js 物件。
 * 注意：描述在建立後不要直接修改裡面的值；要換外觀請指定一個新的描述（或改用 three.js 物件）。
 */
import * as THREE from 'three';

/** 三維向量的寫法：[x, y, z]、{ x, y, z } 或 THREE.Vector3 */
export type Vec3Like =
  | readonly [number, number, number]
  | { readonly x: number; readonly y: number; readonly z: number };

export function toVector3(v: Vec3Like, out = new THREE.Vector3()): THREE.Vector3 {
  return Array.isArray(v)
    ? out.set(v[0], v[1], v[2])
    : out.set((v as THREE.Vector3).x, (v as THREE.Vector3).y, (v as THREE.Vector3).z);
}

// ───────── 幾何 ─────────

/**
 * 幾何描述（尺寸單位是公尺）：
 * - box：邊長，或 [寬, 高, 深]
 * - sphere：半徑，或 [半徑, 經線數, 緯線數]
 * - plane：邊長，或 [寬, 高, 橫向分段, 縱向分段]（面向 +Z；當地板時把 Transform 轉 -90° 繞 X 軸；頂點動畫需要分段）
 * - circle：半徑，或 [半徑, 分段數]
 * - cylinder、cone：[半徑, 高]，可加分段數
 * - capsule：[半徑, 中間的長度]
 * - torus、torusKnot：[半徑, 管子半徑]
 * - dodecahedron、icosahedron、octahedron、tetrahedron：半徑，或 [半徑, 細分]（正多面體）
 * - vertices：自己給頂點 [x, y, z, x, y, z, …]（每三個頂點一個三角形，逆時針是正面）；
 *   可以加 indices（頂點編號，三個一組）、colors（[r, g, b, …] 0~1，搭配材質 vertexColors: true）、uvs；
 *   沒給 normals 時自動計算，例如三角形 { vertices: [-1, 0, 0, 1, 0, 0, 0, 1, 0] }
 * 都可以加 rotation: [x, y, z]（弧度）：先把幾何本身轉好，例如立起來的硬幣 { cylinder: [0.3, 0.06], rotation: [Math.PI / 2, 0, 0] }；
 * 和 offset: [x, y, z]：再移動幾何，例如以底部為中心縮放的方塊 { box: 1, offset: [0, 0.5, 0] }
 */
export type GeometryDesc = (
  | { readonly box: number | readonly number[] }
  | { readonly sphere: number | readonly number[] }
  | { readonly plane: number | readonly number[] }
  | { readonly circle: number | readonly number[] }
  | { readonly cylinder: readonly number[] }
  | { readonly cone: readonly number[] }
  | { readonly capsule: readonly number[] }
  | { readonly torus: readonly number[] }
  | { readonly torusKnot: readonly number[] }
  | { readonly dodecahedron: number | readonly number[] }
  | { readonly icosahedron: number | readonly number[] }
  | { readonly octahedron: number | readonly number[] }
  | { readonly tetrahedron: number | readonly number[] }
  | {
      readonly vertices: readonly number[];
      readonly indices?: readonly number[];
      readonly colors?: readonly number[];
      readonly uvs?: readonly number[];
      readonly normals?: readonly number[];
    }
) & {
  /** 先把幾何轉好（弧度，依 X、Y、Z 順序） */
  readonly rotation?: readonly number[];
  /** 再把幾何移動（例如 [0, 0.5, 0] 讓方塊以底部為中心縮放） */
  readonly offset?: readonly number[];
};

const asArray = (v: number | readonly number[]): (number | undefined)[] => (typeof v === 'number' ? [v] : [...v]);

function shape(desc: GeometryDesc): THREE.BufferGeometry {
  if ('box' in desc) {
    const [w, h = w, d = w] = asArray(desc.box) as number[];
    return new THREE.BoxGeometry(w, h, d);
  }
  if ('sphere' in desc) {
    const [r, ws = 32, hs = 16] = asArray(desc.sphere);
    return new THREE.SphereGeometry(r, ws, hs);
  }
  if ('plane' in desc) {
    const [w, h = w, sx = 1, sy = 1] = asArray(desc.plane) as number[];
    return new THREE.PlaneGeometry(w, h, sx, sy);
  }
  if ('circle' in desc) {
    const [r, seg = 48] = asArray(desc.circle);
    return new THREE.CircleGeometry(r, seg);
  }
  if ('cylinder' in desc) {
    const [r, h, seg = 32] = desc.cylinder;
    return new THREE.CylinderGeometry(r, r, h, seg);
  }
  if ('cone' in desc) {
    const [r, h, seg = 32] = desc.cone;
    return new THREE.ConeGeometry(r, h, seg);
  }
  if ('capsule' in desc) return new THREE.CapsuleGeometry(desc.capsule[0], desc.capsule[1], 8, 16);
  if ('torus' in desc) return new THREE.TorusGeometry(desc.torus[0], desc.torus[1], 24, 64);
  if ('torusKnot' in desc) return new THREE.TorusKnotGeometry(desc.torusKnot[0], desc.torusKnot[1], 128, 16);
  const poly = (v: number | readonly number[]): [number, number] =>
    typeof v === 'number' ? [v, 0] : [v[0], v[1] ?? 0];
  if ('dodecahedron' in desc) return new THREE.DodecahedronGeometry(...poly(desc.dodecahedron));
  if ('icosahedron' in desc) return new THREE.IcosahedronGeometry(...poly(desc.icosahedron));
  if ('octahedron' in desc) return new THREE.OctahedronGeometry(...poly(desc.octahedron));
  if ('tetrahedron' in desc) return new THREE.TetrahedronGeometry(...poly(desc.tetrahedron));
  if ('vertices' in desc) return customGeometry(desc);
  throw new Error(
    `不認識的幾何描述：${JSON.stringify(desc)}（可用：box、sphere、plane、circle、cylinder、cone、capsule、torus、torusKnot、dodecahedron、icosahedron、octahedron、tetrahedron、vertices）`,
  );
}

/** 自己給頂點的幾何（vertices、indices、colors、uvs、normals） */
function customGeometry(desc: Extract<GeometryDesc, { readonly vertices: unknown }>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  if (desc.vertices.length % 3)
    throw new Error(`vertices 的數量要是 3 的倍數（x, y, z），現在是 ${desc.vertices.length}`);
  const count = desc.vertices.length / 3;
  g.setAttribute('position', new THREE.Float32BufferAttribute(desc.vertices as number[], 3));
  const attr = (name: string, list: readonly number[] | undefined, size: number) => {
    if (!list) return;
    if (list.length !== count * size)
      throw new Error(`${name} 要有 ${count * size} 個數字（每個頂點 ${size} 個），現在是 ${list.length}`);
    g.setAttribute(
      name === 'uvs' ? 'uv' : name === 'colors' ? 'color' : 'normal',
      new THREE.Float32BufferAttribute(list as number[], size),
    );
  };
  attr('colors', desc.colors, 3);
  attr('uvs', desc.uvs, 2);
  attr('normals', desc.normals, 3);
  if (desc.indices) g.setIndex(desc.indices as number[]);
  if (!desc.normals) g.computeVertexNormals();
  return g;
}

export function createGeometry(desc: GeometryDesc): THREE.BufferGeometry {
  const g = shape(desc);
  if (desc.rotation) {
    const [x, y, z] = desc.rotation;
    if (x) g.rotateX(x);
    if (y) g.rotateY(y);
    if (z) g.rotateZ(z);
  }
  if (desc.offset) g.translate(desc.offset[0] ?? 0, desc.offset[1] ?? 0, desc.offset[2] ?? 0);
  return g;
}

// ───────── 材質 ─────────

/** 可以寫網址的貼圖欄位（例如 map: 'textures/wood.png'） */
const TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'lightMap',
  'specularMap',
] as const;
type TextureKey = (typeof TEXTURE_KEYS)[number];
/** 顏色貼圖（sRGB）；其他是資料貼圖（法線、粗糙度…，不做色彩轉換） */
const COLOR_TEXTURES = new Set<string>(['map', 'emissiveMap', 'specularMap']);

const SIDES = { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide } as const;
const BLENDINGS = {
  none: THREE.NoBlending,
  normal: THREE.NormalBlending,
  additive: THREE.AdditiveBlending,
  subtractive: THREE.SubtractiveBlending,
  multiply: THREE.MultiplyBlending,
} as const;
const WRAPS = {
  repeat: THREE.RepeatWrapping,
  clamp: THREE.ClampToEdgeWrapping,
  mirror: THREE.MirroredRepeatWrapping,
} as const;

/** 重疊方式（例如發光特效用 'additive'） */
export type BlendingName = keyof typeof BLENDINGS;
/** 貼圖超出 0～1 時：重複、延伸邊緣、鏡像重複 */
export type WrapName = keyof typeof WRAPS;

/**
 * 材質描述的參數：和 three.js 材質的參數一樣，另外：
 * - side：'front'、'back'、'double'
 * - blending：'normal'、'additive'、'subtractive'、'multiply'、'none'
 * - map、normalMap 等貼圖：可以直接寫網址（'textures/wood.png'），自動載入
 * - repeat：貼圖重複幾次（數字或 [橫, 縱]），有設定時預設 wrap: 'repeat'
 */
export type MaterialParams<P> = Omit<P, 'side' | 'blending' | TextureKey> & {
  readonly side?: keyof typeof SIDES | THREE.Side;
  readonly blending?: BlendingName | THREE.Blending;
  readonly repeat?: number | readonly [number, number];
  readonly wrap?: WrapName;
} & { readonly [K in TextureKey & keyof P]?: string | THREE.Texture | null };

/**
 * 材質描述：
 * - standard：一般的 PBR 材質（color、roughness、metalness、emissive…），大多數情況用這個
 * - physical：進階 PBR（clearcoat、transmission…）
 * - basic：不受光照（純色、介面、特效）
 * - lambert、phong：較便宜的光照
 * - toon：卡通風格（一階一階的明暗）
 * - normal：依表面方向上色（不需要燈光，除錯、示範用）
 * - shaderGraph：著色器編輯器的節點圖檔網址，例如 { shaderGraph: 'shaders/lava.shader.json' }（需要安裝 ShaderPlugin；
 *   節點圖載入前物件不顯示）
 * - 也可以直接寫顏色字串或數字：'#ffb347' 等於 { standard: { color: '#ffb347' } }
 */
export type MaterialDesc =
  | string
  | number
  | { readonly standard: MaterialParams<THREE.MeshStandardMaterialParameters> }
  | { readonly physical: MaterialParams<THREE.MeshPhysicalMaterialParameters> }
  | { readonly basic: MaterialParams<THREE.MeshBasicMaterialParameters> }
  | { readonly lambert: MaterialParams<THREE.MeshLambertMaterialParameters> }
  | { readonly phong: MaterialParams<THREE.MeshPhongMaterialParameters> }
  | { readonly toon: MaterialParams<THREE.MeshToonMaterialParameters> }
  | { readonly normal: MaterialParams<THREE.MeshNormalMaterialParameters> }
  | { readonly shaderGraph: string };

/** 描述對應的材質類別（create.material({ standard: … }) 回傳 MeshStandardMaterial） */
export type MaterialOf<D> = D extends { readonly shaderGraph: unknown }
  ? THREE.ShaderMaterial
  : D extends { readonly physical: unknown }
    ? THREE.MeshPhysicalMaterial
    : D extends { readonly basic: unknown }
      ? THREE.MeshBasicMaterial
      : D extends { readonly lambert: unknown }
        ? THREE.MeshLambertMaterial
        : D extends { readonly phong: unknown }
          ? THREE.MeshPhongMaterial
          : D extends { readonly toon: unknown }
            ? THREE.MeshToonMaterial
            : D extends { readonly normal: unknown }
              ? THREE.MeshNormalMaterial
              : THREE.MeshStandardMaterial;

/** 貼圖的設定（同樣的網址、設定共用同一張） */
export interface TextureOptions {
  /** 色彩空間：顏色貼圖用 srgb，資料貼圖（法線、粗糙度）用 none */
  colorSpace: 'srgb' | 'none';
  /** 重複次數 [橫, 縱]（null：不設定） */
  repeat: readonly [number, number] | null;
  /** 超出 0～1 時的方式（null：不設定） */
  wrap: WrapName | null;
  /** 像素風：放大時不模糊（最近點取樣） */
  pixelated?: boolean;
}

/** 取得貼圖（預設直接載入；RenderResources 會共用並管理釋放） */
export type TextureSource = (url: string, options: TextureOptions) => THREE.Texture;

/** 載入貼圖並套用設定 */
export function loadTexture(url: string, options: TextureOptions): THREE.Texture {
  const tex = new THREE.TextureLoader().load(url);
  configureTexture(tex, options);
  return tex;
}

/** 可以直接做成貼圖的圖片來源：畫布、圖片、ImageBitmap、影片 */
export type TextureImage = HTMLCanvasElement | OffscreenCanvas | HTMLImageElement | ImageBitmap | HTMLVideoElement;

/** 用畫布（或圖片、影片）建立貼圖；畫布畫了新內容後設定 texture.needsUpdate = true */
export function imageTexture(image: TextureImage, options: TextureOptions): THREE.Texture {
  const tex =
    typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement
      ? new THREE.VideoTexture(image)
      : new THREE.CanvasTexture(image as HTMLCanvasElement);
  configureTexture(tex, options);
  return tex;
}

function configureTexture(tex: THREE.Texture, o: TextureOptions): void {
  if (o.colorSpace === 'srgb') tex.colorSpace = THREE.SRGBColorSpace;
  const wrap = o.wrap ?? (o.repeat ? 'repeat' : null);
  if (wrap) tex.wrapS = tex.wrapT = WRAPS[wrap];
  if (o.repeat) tex.repeat.set(o.repeat[0], o.repeat[1]);
  if (o.pixelated) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
  }
}

/** 把 side、blending 的名稱（'double'、'additive'…）換成 three.js 的常數；其他欄位不變（自訂著色器的材質參數也用這個） */
export function materialConstants<T extends Record<string, unknown>>(options: T): T {
  const out: Record<string, unknown> = { ...options };
  if (typeof out.side === 'string') out.side = SIDES[out.side as keyof typeof SIDES];
  if (typeof out.blending === 'string') out.blending = BLENDINGS[out.blending as BlendingName];
  return out as T;
}

function params<P extends object>(p: MaterialParams<P>, textures: TextureSource): P {
  const { side, blending, repeat, wrap, ...rest } = p as MaterialParams<P> & Record<string, unknown>;
  const out: Record<string, unknown> = { ...rest };
  if (side !== undefined) out.side = typeof side === 'string' ? SIDES[side] : side;
  if (blending !== undefined) out.blending = typeof blending === 'string' ? BLENDINGS[blending] : blending;
  const rep = repeat === undefined ? null : typeof repeat === 'number' ? ([repeat, repeat] as const) : repeat;
  for (const key of TEXTURE_KEYS) {
    const v = out[key];
    const options: TextureOptions = {
      colorSpace: COLOR_TEXTURES.has(key) ? 'srgb' : 'none',
      repeat: rep,
      wrap: wrap ?? null,
    };
    if (typeof v === 'string') out[key] = textures(v, options);
    else if (v instanceof THREE.Texture && (rep || wrap)) configureTexture(v, options);
  }
  return out as unknown as P;
}

/** 自訂的材質描述：描述裡這個鍵的值 → 材質（例如 ShaderPlugin 登記的 { shaderGraph: '網址' }） */
export type MaterialFactory = (value: unknown, desc: Readonly<Record<string, unknown>>) => THREE.Material;
const materialFactories = new Map<string, MaterialFactory>();

/**
 * 登記一種自訂的材質描述（其他模組擴充材質描述用，例如 ShaderPlugin 登記 shaderGraph）。
 * 回傳取消登記的函式。
 * @example
 * const off = registerMaterialType('shaderGraph', (url) => makeGraphMaterial(String(url)));
 */
export function registerMaterialType(key: string, factory: MaterialFactory): () => void {
  materialFactories.set(key, factory);
  return () => {
    if (materialFactories.get(key) === factory) materialFactories.delete(key);
  };
}

export function createMaterial<D extends MaterialDesc>(desc: D, textures: TextureSource = loadTexture): MaterialOf<D> {
  const d = desc as MaterialDesc;
  let m: THREE.Material;
  if (typeof d === 'string' || typeof d === 'number') m = new THREE.MeshStandardMaterial({ color: d });
  else if ('standard' in d) m = new THREE.MeshStandardMaterial(params(d.standard, textures));
  else if ('physical' in d) m = new THREE.MeshPhysicalMaterial(params(d.physical, textures));
  else if ('basic' in d) m = new THREE.MeshBasicMaterial(params(d.basic, textures));
  else if ('lambert' in d) m = new THREE.MeshLambertMaterial(params(d.lambert, textures));
  else if ('phong' in d) m = new THREE.MeshPhongMaterial(params(d.phong, textures));
  else if ('toon' in d) m = new THREE.MeshToonMaterial(params(d.toon, textures));
  else if ('normal' in d) m = new THREE.MeshNormalMaterial(params(d.normal, textures));
  else if (Object.keys(d).length === 1 && materialFactories.has(Object.keys(d)[0])) {
    const key = Object.keys(d)[0];
    m = materialFactories.get(key)!((d as Record<string, unknown>)[key], d as Record<string, unknown>);
  } else if ('shaderGraph' in d)
    throw new Error(`材質 ${JSON.stringify(desc)} 是節點圖，需要先安裝 ShaderPlugin（@engine/shaders）`);
  else
    throw new Error(
      `不認識的材質描述：${JSON.stringify(desc)}（可用：standard、physical、basic、lambert、phong、toon、normal，或顏色）`,
    );
  return m as MaterialOf<D>;
}

export const isGeometryDesc = (v: unknown): v is GeometryDesc =>
  typeof v === 'object' && v !== null && !(v instanceof THREE.BufferGeometry);
export const isMaterialDesc = (v: unknown): v is MaterialDesc =>
  typeof v === 'string' ||
  typeof v === 'number' ||
  (typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof THREE.Material));

// ───────── 共用與釋放 ─────────

/** 鍵的順序不影響結果的 JSON（{ a: 1, b: 2 } 和 { b: 2, a: 1 } 是同一個描述） */
export function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  const keys = Object.keys(value as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableKey((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

interface Entry<T> {
  value: T;
  refs: number;
  /** 材質用到的貼圖（材質釋放時一起歸還） */
  textures?: string[];
}

/**
 * 描述建立的幾何、材質、貼圖：內容一樣的共用同一份，用參考計數管理。
 * 沒有人用的會在下一次 sweep()（每幀同步之後）釋放；同一幀裡換場景（先刪後建）可以直接重用，不會重新編譯著色器。
 * 貼圖：同一個網址、同樣設定（重複次數、色彩空間）共用一張，用到它的材質都釋放後才釋放。
 */
export class RenderResources {
  private readonly geometries = new Map<string, Entry<THREE.BufferGeometry>>();
  private readonly materials = new Map<string, Entry<THREE.Material>>();
  private readonly textures = new Map<string, Entry<THREE.Texture>>();

  /** 載入貼圖的方式（測試可替換） */
  constructor(private readonly load: (url: string, options: TextureOptions) => THREE.Texture = loadTexture) {}

  /** 取得描述對應的幾何（共用；用完要 release） */
  acquireGeometry(desc: GeometryDesc): { key: string; value: THREE.BufferGeometry } {
    return this.acquire(this.geometries, `g${stableKey(desc)}`, () => createGeometry(desc));
  }

  /** 取得描述對應的材質（共用；用完要 release） */
  acquireMaterial(desc: MaterialDesc): { key: string; value: THREE.Material } {
    const key = `m${stableKey(desc)}`;
    const found = this.materials.get(key);
    if (found) {
      found.refs++;
      return { key, value: found.value };
    }
    const used: string[] = [];
    const value = createMaterial(desc, (url, options) => {
      const t = this.acquire(this.textures, `t${stableKey({ url, ...options })}`, () => this.load(url, options));
      used.push(t.key);
      return t.value;
    });
    this.materials.set(key, { value, refs: 1, textures: used });
    return { key, value };
  }

  /** 歸還（參考次數減一；沒人用的在下一次 sweep 釋放） */
  release(key: string): void {
    const map = key[0] === 'g' ? this.geometries : key[0] === 't' ? this.textures : this.materials;
    const entry = map.get(key) as Entry<unknown> | undefined;
    if (entry && entry.refs > 0) entry.refs--;
  }

  /** 釋放沒有人用的（材質先釋放，歸還它的貼圖，再釋放沒有材質在用的貼圖） */
  sweep(): void {
    for (const map of [this.geometries, this.materials, this.textures] as Map<string, Entry<{ dispose(): void }>>[]) {
      for (const [key, entry] of map) {
        if (entry.refs > 0) continue;
        entry.value.dispose();
        for (const t of entry.textures ?? []) this.release(t);
        map.delete(key);
      }
    }
  }

  /** 目前的數量（除錯、測試用） */
  get stats(): { geometries: number; materials: number; textures: number } {
    return { geometries: this.geometries.size, materials: this.materials.size, textures: this.textures.size };
  }

  /** 釋放全部 */
  dispose(): void {
    for (const map of [this.geometries, this.materials, this.textures] as Map<string, Entry<{ dispose(): void }>>[]) {
      for (const e of map.values()) e.value.dispose();
      map.clear();
    }
  }

  private acquire<T>(map: Map<string, Entry<T>>, key: string, create: () => T): { key: string; value: T } {
    let entry = map.get(key);
    if (!entry) map.set(key, (entry = { value: create(), refs: 0 }));
    entry.refs++;
    return { key, value: entry.value };
  }
}
