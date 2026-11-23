import * as THREE from 'three';
import {
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  MeshPhongNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
} from 'three/webgpu';
import { materialConstants } from '../render/descriptors';
import { shaderFns } from './functions';
import { type ShaderNode, tsl } from './tsl';

const {
  Fn,
  cameraPosition,
  convertToTexture,
  deltaTime,
  float,
  normalLocal,
  normalWorld,
  normalize,
  output,
  positionLocal,
  positionWorld,
  screenSize,
  screenUV,
  texture,
  time,
  uniform,
  uv,
  vec2,
} = tsl;

/** uniform 的值：數字、布林、向量、顏色、矩陣、貼圖（null：之後才給的貼圖） */
export type UniformInput =
  | number
  | boolean
  | THREE.Vector2
  | THREE.Vector3
  | THREE.Vector4
  | THREE.Color
  | THREE.Matrix3
  | THREE.Matrix4
  | THREE.Texture
  | null;

/** 自訂著色器建立在哪種材質上：unlit（完全自訂）或 standard、physical、lambert、phong、basic（保留光照，只改一部分） */
export type ShaderBase = 'unlit' | 'standard' | 'physical' | 'lambert' | 'phong' | 'basic';

/** 一個 uniform：節點（放進著色器）＋ value（隨時可以改，下一幀生效） */
export type UniformNode = ShaderNode & { value: unknown };

/**
 * 自訂材質的函式拿到的東西（都是 TSL 節點）。
 * 函式在建立材質時執行一次，組出節點；之後每一幀都在 GPU 上執行
 */
export interface ShaderContext {
  /** 你定義的 uniform（這個材質自己的一份；改 material.uniforms.名稱.value） */
  uniforms: Record<string, UniformNode>;
  /** 經過的時間（秒） */
  time: ShaderNode;
  /** 這一幀的時間（秒） */
  deltaTime: ShaderNode;
  /** 畫面大小（像素，vec2） */
  resolution: ShaderNode;
  /** 貼圖座標（vec2） */
  uv: ShaderNode;
  /** 物件座標的位置（vec3，頂點函式回傳新的位置） */
  position: ShaderNode;
  /** 物件座標的法線（vec3） */
  normal: ShaderNode;
  /** 世界座標的位置（vec3） */
  worldPosition: ShaderNode;
  /** 世界座標的法線（vec3） */
  worldNormal: ShaderNode;
  /** 攝影機位置（世界座標） */
  cameraPosition: ShaderNode;
  /** 從表面指向攝影機的方向（世界座標，已正規化） */
  viewDir: ShaderNode;
  /** 共用函式：雜訊、碎形雜訊、Voronoi、菲涅耳…（同 shaderFns） */
  fn: typeof shaderFns;
}

/**
 * 自訂材質的定義（TSL：每個欄位是回傳節點的函式）。
 *
 * - base: 'unlit'：完全自訂，color 回傳最後的顏色（vec4）
 * - base: 'standard' 等：保留光照與陰影，color 回傳基本色（vec4，光照前），emissive 回傳發光（vec3）
 *
 * 函式裡可以用 three/tsl 的所有函式（vec3、mix、sin…）與控制流程（If、Discard 丟棄像素）。
 * @example
 * shaders.define({
 *   name: 'pulse',
 *   base: 'standard',
 *   uniforms: { uColor: new Color('#ff6b6b') },
 *   color: (c) => vec4(c.uniforms.uColor, 1),
 *   emissive: (c) => c.uniforms.uColor.mul(sin(c.time.mul(3)).mul(0.5).add(0.5)),
 * });
 */
export interface ShaderDefinition {
  /** 著色器名稱（createMaterial 用） */
  name: string;
  /** 建立在哪種材質上 */
  base: ShaderBase;
  /** 你的 uniform 與初始值 */
  uniforms?: Record<string, UniformInput>;
  /** 傳給材質的參數，例如 { color: 0xff0000, roughness: 0.3, transparent: true, side: 'double', blending: 'additive' } */
  options?: Record<string, unknown>;
  /** 頂點位置：回傳新的物件座標位置（vec3），例如 c.position.add(c.normal.mul(0.1)) */
  position?: (c: ShaderContext) => ShaderNode;
  /** 顏色（vec4）：unlit 是最後的顏色；標準材質是基本色（光照前）。可以呼叫 Discard() 丟棄像素 */
  color?: (c: ShaderContext) => ShaderNode;
  /** 只限有光照的材質：發光（vec3） */
  emissive?: (c: ShaderContext) => ShaderNode;
  /** 最後的輸出（vec4，色調映射之前）：拿到原本的輸出，回傳新的 */
  output?: (c: ShaderContext, color: ShaderNode) => ShaderNode;
}

/** 全螢幕效果的函式拿到的東西 */
export interface EffectContext {
  /** 你定義的 uniform（這個效果自己的一份；改 effect.uniforms.名稱.value） */
  uniforms: Record<string, UniformNode>;
  /** 目前像素原本的顏色（vec4） */
  color: ShaderNode;
  /** 畫面座標（vec2，左下 0,0 到右上 1,1） */
  uv: ShaderNode;
  /** 讀取畫面任意位置的顏色：sample(uv) → vec4 */
  sample: (uv: ShaderNode) => ShaderNode;
  /** 經過的時間（秒） */
  time: ShaderNode;
  /** 這一幀的時間（秒） */
  deltaTime: ShaderNode;
  /** 畫面大小（像素，vec2） */
  resolution: ShaderNode;
  /** 共用函式（同 shaderFns） */
  fn: typeof shaderFns;
}

/**
 * 自訂全螢幕效果的定義：color 回傳這個像素的新顏色（vec4）。
 * @example
 * shaders.defineEffect({
 *   name: 'invert',
 *   uniforms: { uAmount: 1 },
 *   color: (c) => vec4(mix(c.color.rgb, c.color.rgb.oneMinus(), c.uniforms.uAmount), c.color.a),
 * });
 */
export interface EffectDefinition {
  /** 全螢幕效果名稱（createEffect 用） */
  name: string;
  /** uniform 的初始值 */
  uniforms?: Record<string, UniformInput>;
  /** 這個像素的新顏色（vec4） */
  color: (c: EffectContext) => ShaderNode;
}

/** 用自訂著色器建立的材質：可以透過 uniforms 修改參數（uniforms.名稱.value） */
export type CustomMaterial = THREE.Material & {
  uniforms: Record<string, UniformNode>;
  readonly shaderName: string;
};

/**
 * 後製的一個效果（交給 postfx.addPass）：apply 拿到前一個效果的顏色（節點），回傳新的顏色。
 * 自己寫效果時實作這個介面即可；shaders.createEffect 建立的效果也是
 */
export interface PostFxPass {
  /** false：暫時不套用 */
  enabled: boolean;
  /** 定義改變時加一（後製看到會重建效果） */
  readonly version?: number;
  /** 套用效果：input 是前一個效果的顏色（vec4 節點），回傳新的顏色 */
  apply(input: ShaderNode): ShaderNode;
}

/** 自訂效果（可交給 PostProcessingPlugin.addPass，或放進 postfx.settings.effects） */
export interface CustomEffect extends PostFxPass {
  /** 效果的名稱（defineEffect 的 name） */
  readonly shaderName: string;
  /** 這個效果的 uniform（改 .value，下一幀生效） */
  readonly uniforms: Record<string, UniformNode>;
  readonly version: number;
  /** 不再使用（先 postfx.removePass）：shaders.update 不再更新它 */
  dispose(): void;
}

const BASE_MATERIALS = {
  unlit: MeshBasicNodeMaterial,
  standard: MeshStandardNodeMaterial,
  physical: MeshPhysicalNodeMaterial,
  lambert: MeshLambertNodeMaterial,
  phong: MeshPhongNodeMaterial,
  basic: MeshBasicNodeMaterial,
} as const;

/** 之後才給的貼圖（uniform 的初始值是 null）先用的 1×1 白色貼圖 */
let blankTexture: THREE.DataTexture | null = null;
function blank(): THREE.DataTexture {
  if (!blankTexture) {
    blankTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    blankTexture.needsUpdate = true;
  }
  return blankTexture;
}

/** 每個實例各自一份 uniform 節點（貼圖共用，向量等複製） */
function uniformNode(input: unknown): UniformNode {
  if (input === null || input instanceof THREE.Texture) return texture(input ?? blank());
  if (typeof input === 'boolean') return uniform(input ? 1 : 0);
  const v =
    input && typeof (input as { clone?: unknown }).clone === 'function' ? (input as THREE.Vector3).clone() : input;
  return uniform(v);
}

function makeUniforms(
  name: string,
  defs: Record<string, UniformInput> | undefined,
  overrides: Record<string, unknown>,
): Record<string, UniformNode> {
  const own: Record<string, UniformNode> = {};
  for (const [key, input] of Object.entries(defs ?? {})) own[key] = uniformNode(input);
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in own)) throw new Error(`著色器「${name}」沒有 uniform「${key}」`);
    own[key].value = value === null ? blank() : value;
  }
  return own;
}

function materialContext(uniforms: Record<string, UniformNode>): ShaderContext {
  return {
    uniforms,
    time,
    deltaTime,
    resolution: screenSize,
    uv: uv(),
    position: positionLocal,
    normal: normalLocal,
    worldPosition: positionWorld,
    worldNormal: normalWorld,
    cameraPosition,
    viewDir: normalize(cameraPosition.sub(positionWorld)),
    fn: shaderFns,
  };
}

/** 依定義設定材質的節點（建立時、update 時） */
function applyNodes(material: THREE.Material, def: ShaderDefinition, uniforms: Record<string, UniformNode>): void {
  const ctx = materialContext(uniforms);
  const m = material as THREE.Material & {
    positionNode: ShaderNode;
    colorNode: ShaderNode;
    emissiveNode: ShaderNode;
    outputNode: ShaderNode;
  };
  m.positionNode = def.position ? Fn(() => def.position!(ctx))() : null;
  m.colorNode = def.color ? Fn(() => def.color!(ctx))() : null;
  m.emissiveNode = def.emissive && def.base !== 'unlit' && def.base !== 'basic' ? Fn(() => def.emissive!(ctx))() : null;
  m.outputNode = def.output ? Fn(() => def.output!(ctx, output))() : null;
  material.needsUpdate = true;
}

interface Entry {
  kind: 'material' | 'effect';
  def: ShaderDefinition | EffectDefinition;
  version: number;
  live: Set<CustomMaterial | CustomEffect>;
}

/**
 * 著色器庫：註冊自訂材質與全螢幕效果（TSL 節點）、建立實例、執行中更新。
 * 透過 world.requireResource(ShadersKey) 取得（ShaderPlugin 匯出成 shaders）。
 */
export class ShaderLibrary {
  private readonly entries = new Map<string, Entry>();
  private anonymous = 0;

  /** 是否定義了這個著色器或效果 */
  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** 所有定義過的名稱 */
  get names(): string[] {
    return [...this.entries.keys()];
  }

  /** 著色器或效果的定義 */
  definition(name: string): ShaderDefinition | EffectDefinition | undefined {
    return this.entries.get(name)?.def;
  }

  /** 移除註冊（已建立的實例照常運作，但不能再 update） */
  remove(name: string): boolean {
    return this.entries.delete(name);
  }

  /** 定義的版本：每次 define、update 加一（後製用它判斷要不要重建效果）；沒有這個名稱時是 0 */
  version(name: string): number {
    return this.entries.get(name)?.version ?? 0;
  }

  /** 目前還在使用中的實例數量 */
  liveCount(name: string): number {
    return this.entries.get(name)?.live.size ?? 0;
  }

  // ───────── 註冊 ─────────

  /** 註冊自訂材質 */
  define(def: ShaderDefinition): this {
    this.validate(def);
    this.register(def.name, 'material', def);
    return this;
  }

  /** 註冊自訂全螢幕效果 */
  defineEffect(def: EffectDefinition): this {
    if (typeof def.color !== 'function') throw new Error(`效果「${def.name}」需要 color 函式（回傳新的顏色）`);
    this.register(def.name, 'effect', def);
    return this;
  }

  /**
   * 執行中更新定義：所有使用中的實例會換成新的節點，既有的 uniform 數值會保留（新增的 uniform 用初始值）。
   */
  update(name: string, changes: Partial<ShaderDefinition> | Partial<EffectDefinition>): void {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`找不到著色器「${name}」`);
    const def = { ...entry.def, ...changes, name } as ShaderDefinition & EffectDefinition;
    if (entry.kind === 'material') this.validate(def);
    entry.def = def;
    entry.version++;
    for (const instance of entry.live) {
      for (const [key, input] of Object.entries(def.uniforms ?? {})) {
        if (!(key in instance.uniforms)) (instance.uniforms as Record<string, UniformNode>)[key] = uniformNode(input);
      }
      if (entry.kind === 'material') applyNodes(instance as CustomMaterial, def, instance.uniforms);
      else (instance as { version: number }).version = entry.version; // 後製看到版本變了會重建
    }
  }

  // ───────── 建立實例 ─────────

  /**
   * 建立材質。每次呼叫都是新的實例，uniform 各自獨立（例如每個敵人各自的溶解進度）。
   * @param uniforms 覆蓋這個實例的 uniform 初始值
   * @param options 覆蓋這個實例的材質參數（例如 { color: 0xff0000 }）
   */
  createMaterial(
    name: string,
    uniforms: Record<string, unknown> = {},
    options: Record<string, unknown> = {},
  ): CustomMaterial {
    const entry = this.entry(name, 'material');
    const def = entry.def as ShaderDefinition;
    const own = makeUniforms(name, def.uniforms, uniforms);
    const Base = BASE_MATERIALS[def.base];
    const m = new Base(materialConstants({ ...def.options, ...options }) as never) as THREE.Material;
    Object.assign(m, { uniforms: own, shaderName: name });
    applyNodes(m, def, own);
    const material = m as CustomMaterial;
    this.track(entry, material);
    return material;
  }

  /**
   * 直接用定義建立材質，不註冊名稱（不能 update；節點圖材質、編輯器預覽這種每次內容都不同的用）。
   * 材質的 shaderName 是定義的 name。
   * @example
   * const m = shaders.createFromDefinition(await loadShaderGraph('shaders/lava.shader.json'));
   */
  createFromDefinition(
    def: ShaderDefinition,
    uniforms: Record<string, unknown> = {},
    options: Record<string, unknown> = {},
  ): CustomMaterial {
    const name = `${def.name}#${++this.anonymous}`;
    this.define({ ...def, name });
    try {
      const material = this.createMaterial(name, uniforms, options);
      Object.assign(material, { shaderName: def.name });
      return material;
    } finally {
      this.entries.delete(name);
    }
  }

  /** 建立全螢幕效果，交給 postfx.addPass(effect, 'display') 或放進 postfx.settings.effects */
  createEffect(name: string, uniforms: Record<string, unknown> = {}): CustomEffect {
    const entry = this.entry(name, 'effect');
    const own = makeUniforms(name, (entry.def as EffectDefinition).uniforms, uniforms);
    const effect: CustomEffect = {
      shaderName: name,
      uniforms: own,
      enabled: true,
      version: entry.version,
      apply: (input: ShaderNode) => {
        const def = entry.def as EffectDefinition;
        // 要讀取畫面其他位置（sample）時，才把前一個效果的結果先畫成貼圖：
        // 只用到這個像素的效果（調色、暗角…）直接接著算，不用多一次全螢幕的複製
        let tex: ShaderNode | null = null;
        const texture = () => (tex ??= convertToTexture(input));
        // 畫面座標：左下 (0,0)、右上 (1,1)（y 往上）；TSL 的 screenUV 是左上 (0,0)，這裡翻過來
        const flip = (p: ShaderNode) => vec2(p.x, float(1).sub(p.y));
        const fsUv = flip(screenUV);
        const ctx: EffectContext = {
          uniforms: own,
          color: input,
          uv: fsUv,
          sample: (p: ShaderNode) => texture().sample(flip(p)),
          time,
          deltaTime,
          resolution: screenSize,
          fn: shaderFns,
        };
        return Fn(() => def.color(ctx))();
      },
      dispose: () => {
        entry.live.delete(effect);
      },
    };
    this.track(entry, effect);
    return effect;
  }

  // ───────── 內部 ─────────

  private register(name: string, kind: Entry['kind'], def: Entry['def']): void {
    if (!name) throw new Error('著色器需要名稱');
    const prev = this.entries.get(name);
    this.entries.set(name, { kind, def, version: (prev?.version ?? 0) + 1, live: prev?.live ?? new Set() });
  }

  private entry(name: string, kind: Entry['kind']): Entry {
    const entry = this.entries.get(name);
    if (!entry)
      throw new Error(
        `找不到${kind === 'effect' ? '效果' : '著色器'}「${name}」（先用 ${kind === 'effect' ? 'defineEffect' : 'define'} 註冊）`,
      );
    if (entry.kind !== kind)
      throw new Error(
        `「${name}」是${entry.kind === 'effect' ? '全螢幕效果，請用 createEffect' : '材質，請用 createMaterial'}`,
      );
    return entry;
  }

  private track(entry: Entry, instance: CustomMaterial | CustomEffect): void {
    entry.live.add(instance);
    if (instance instanceof THREE.Material) instance.addEventListener('dispose', () => entry.live.delete(instance));
  }

  private validate(def: ShaderDefinition): void {
    for (const key of ['vertex', 'fragment', 'vertexHeader', 'fragmentHeader'] as const)
      if (key in def)
        throw new Error(
          `著色器「${def.name}」用了舊的 GLSL 寫法（${key}）：現在的自訂著色器用 TSL 節點，請改用 position、color、emissive 函式`,
        );
    if (!(def.base in BASE_MATERIALS)) throw new Error(`著色器「${def.name}」的 base 不正確：${def.base}`);
    if (def.base === 'unlit' && !def.color) throw new Error(`著色器「${def.name}」是 unlit，需要 color 函式`);
  }
}
