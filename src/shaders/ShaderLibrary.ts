import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { materialConstants } from '../render/descriptors';
import { registerBuiltinChunks } from './chunks';

/** uniform 的值；需要指定 GLSL 型別時（例如陣列）用 { value, glsl: 'vec3[4]' } */
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
  | null
  | { value: unknown; glsl: string };

/** 自訂著色器建立在哪種材質上：unlit（完全自訂）或 standard、physical、lambert、phong、basic（保留光照，只改一部分） */
export type ShaderBase = 'unlit' | 'standard' | 'physical' | 'lambert' | 'phong' | 'basic';

/**
 * 自訂材質的定義。
 *
 * 兩種模式：
 * - base: 'unlit'：完全自訂，在 fragment 裡設定 `color`（vec4）
 * - base: 'standard' 等：擴充 three.js 的標準材質，保留光照與陰影，
 *   在 fragment 裡修改 `diffuseColor`（vec4），在 emissive 裡修改 `totalEmissiveRadiance`（vec3）
 *
 * 所有模式都可以使用：
 * - uniform：uTime（秒）、uDeltaTime、uResolution（畫面像素）、cameraPosition，以及你定義的 uniforms
 * - 頂點階段：`transformed`（vec3，可修改頂點位置）、`position`、`normal`、`uv`
 * - 片段階段：vUv、vWorldPosition、vWorldNormal
 * - #include <engine_noise>、#include <engine_utils> 等共用片段
 */
export interface ShaderDefinition {
  /** 著色器名稱（createMaterial 用） */
  name: string;
  /** 建立在哪種材質上 */
  base: ShaderBase;
  /** 你的 uniform：會依數值型別自動產生 GLSL 宣告 */
  uniforms?: Record<string, UniformInput>;
  /** 傳給材質的參數，例如 { color: 0xff0000, roughness: 0.3, transparent: true, side: 'double', blending: 'additive' } */
  options?: Record<string, unknown>;
  /** 頂點著色器的函式與宣告 */
  vertexHeader?: string;
  /** 在 main 裡執行，可修改 `transformed` 來移動頂點 */
  vertex?: string;
  /** 片段著色器的函式與宣告 */
  fragmentHeader?: string;
  /** unlit：設定 `color`；標準材質：修改 `diffuseColor`（可 discard） */
  fragment?: string;
  /** 只限標準材質：修改 `totalEmissiveRadiance` 讓表面發光 */
  emissive?: string;
  /** 最後修改 `gl_FragColor`（色調映射之前） */
  output?: string;
}

/**
 * 自訂全螢幕效果的定義。
 * fragment 裡可以使用 `color`（目前像素，vec4，修改它）、`uv`、tDiffuse（整張畫面）、uResolution、uTime。
 */
export interface EffectDefinition {
  /** 全螢幕效果名稱（createEffect 用） */
  name: string;
  /** uniform 的初始值 */
  uniforms?: Record<string, UniformInput>;
  /** 放在片段著色器最前面的程式（函式、常數） */
  header?: string;
  /** 片段著色器的主程式 */
  fragment: string;
}

/** 用自訂著色器建立的材質：無論哪種模式，都可以透過 uniforms 修改參數 */
export type CustomMaterial = THREE.Material & {
  uniforms: Record<string, THREE.IUniform>;
  readonly shaderName: string;
};

/** 自訂效果（可交給 PostProcessingPlugin.addPass） */
export type CustomEffect = ShaderPass & { readonly shaderName: string };

const BASE_MATERIALS = {
  standard: THREE.MeshStandardMaterial,
  physical: THREE.MeshPhysicalMaterial,
  lambert: THREE.MeshLambertMaterial,
  phong: THREE.MeshPhongMaterial,
  basic: THREE.MeshBasicMaterial,
} as const;

const BUILTIN_UNIFORMS = ['uTime', 'uDeltaTime', 'uResolution'] as const;

/** 依數值推斷 GLSL 型別 */
export function glslType(value: unknown, name = ''): string {
  if (typeof value === 'number') return 'float';
  if (typeof value === 'boolean') return 'bool';
  if (value instanceof THREE.Color) return 'vec3';
  if (value instanceof THREE.Vector2) return 'vec2';
  if (value instanceof THREE.Vector3) return 'vec3';
  if (value instanceof THREE.Vector4) return 'vec4';
  if (value instanceof THREE.Matrix3) return 'mat3';
  if (value instanceof THREE.Matrix4) return 'mat4';
  if (value instanceof THREE.CubeTexture) return 'samplerCube';
  if (value instanceof THREE.Texture || value === null) return 'sampler2D';
  throw new Error(`無法推斷 uniform「${name}」的 GLSL 型別，請改用 { value, glsl: '型別' }`);
}

function declaration(name: string, input: UniformInput): string {
  if (input !== null && typeof input === 'object' && 'glsl' in input) {
    const m = /^(\w+)(\[\d+\])?$/.exec(input.glsl.trim());
    if (!m) throw new Error(`uniform「${name}」的 glsl 型別格式錯誤：${input.glsl}`);
    return `uniform ${m[1]} ${name}${m[2] ?? ''};`;
  }
  return `uniform ${glslType(input, name)} ${name};`;
}

/** 每個材質各自一份 uniform 值（貼圖共用，向量等複製） */
function cloneValue(input: UniformInput): unknown {
  const v = input !== null && typeof input === 'object' && 'glsl' in input ? input.value : input;
  if (v instanceof THREE.Texture) return v;
  if (Array.isArray(v)) return v.map((x) => (x && typeof x.clone === 'function' ? x.clone() : x));
  if (v && typeof (v as { clone?: unknown }).clone === 'function') return (v as { clone: () => unknown }).clone();
  return v;
}

/** 在 three.js 的著色器原始碼中，找到標記並在其後插入程式碼 */
function injectAfter(source: string, anchor: string, code: string, shaderName: string): string {
  const token = `#include <${anchor}>`;
  if (!source.includes(token)) {
    throw new Error(`著色器「${shaderName}」無法插入程式碼：找不到 ${token}（這種基礎材質可能不支援）`);
  }
  return source.replace(token, `${token}\n${code}\n`);
}

interface Entry {
  kind: 'material' | 'effect';
  def: ShaderDefinition | EffectDefinition;
  version: number;
  live: Set<CustomMaterial | CustomEffect>;
}

/**
 * 著色器庫：註冊自訂材質與全螢幕效果、建立實例、執行中更新。
 * 透過 world.requireResource(ShadersKey) 取得。
 */
export class ShaderLibrary {
  /** 所有自訂著色器共用的內建 uniform（由 ShaderPlugin 每幀更新） */
  readonly builtins = {
    uTime: { value: 0 },
    uDeltaTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };
  private readonly entries = new Map<string, Entry>();
  private anonymous = 0;

  constructor() {
    registerBuiltinChunks();
  }

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
    this.checkUniforms(def.name, def.uniforms);
    this.register(def.name, 'effect', def);
    return this;
  }

  /**
   * 執行中更新定義：所有使用中的實例會重新編譯，既有的 uniform 數值會保留。
   * 搭配 Vite 熱更新，修改 .glsl 檔就能立刻看到結果。
   */
  update(name: string, changes: Partial<ShaderDefinition> | Partial<EffectDefinition>): void {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`找不到著色器「${name}」`);
    const def = { ...entry.def, ...changes, name } as ShaderDefinition & EffectDefinition;
    if (entry.kind === 'material') this.validate(def);
    else this.checkUniforms(name, def.uniforms);
    entry.def = def;
    entry.version++;
    for (const instance of entry.live) {
      // 補上新增的 uniform（保留既有的值）
      for (const [key, input] of Object.entries(def.uniforms ?? {})) {
        if (!(key in instance.uniforms)) instance.uniforms[key] = { value: cloneValue(input) };
      }
      if (entry.kind === 'effect') {
        const pass = instance as CustomEffect;
        (pass.material as THREE.ShaderMaterial).fragmentShader = this.effectFragment(def);
        pass.material.needsUpdate = true;
      } else if (def.base === 'unlit') {
        const m = instance as unknown as THREE.ShaderMaterial;
        m.vertexShader = this.unlitVertex(def);
        m.fragmentShader = this.unlitFragment(def);
        m.needsUpdate = true;
      } else {
        (instance as CustomMaterial).needsUpdate = true; // onBeforeCompile 會讀取新定義
      }
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
    const own: Record<string, THREE.IUniform> = {};
    for (const [key, input] of Object.entries(def.uniforms ?? {})) own[key] = { value: cloneValue(input) };
    for (const [key, value] of Object.entries(uniforms)) {
      if (!(key in own)) throw new Error(`著色器「${name}」沒有 uniform「${key}」`);
      own[key].value = value;
    }

    let material: CustomMaterial;
    if (def.base === 'unlit') {
      const m = new THREE.ShaderMaterial({
        ...(materialConstants({ ...def.options, ...options }) as THREE.ShaderMaterialParameters),
        uniforms: { ...own, ...this.builtins },
        vertexShader: this.unlitVertex(def),
        fragmentShader: this.unlitFragment(def),
      });
      // ShaderMaterial 的 uniforms 同時包含內建與自訂；對外只露出同一個物件
      material = Object.assign(m, { shaderName: name }) as unknown as CustomMaterial;
    } else {
      const Base = BASE_MATERIALS[def.base];
      const m = new Base(materialConstants({ ...def.options, ...options }) as never) as THREE.Material;
      Object.assign(m, { uniforms: own, shaderName: name });
      m.onBeforeCompile = (shader) => this.patch(name, shader, own);
      m.customProgramCacheKey = () => `${name}:${this.entries.get(name)?.version ?? 0}`;
      material = m as CustomMaterial;
    }
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
    let material: CustomMaterial;
    try {
      material = this.createMaterial(name, uniforms, options);
    } catch (error) {
      this.entries.delete(name);
      throw error;
    }
    Object.assign(material, { shaderName: def.name });
    // unlit 的原始碼已經產生好；標準材質編譯時才讀定義，要等材質釋放後才移除
    if (def.base === 'unlit') this.entries.delete(name);
    else material.addEventListener('dispose', () => this.entries.delete(name));
    return material;
  }

  /** 建立全螢幕效果，交給 postfx.addPass(effect, 'display') 使用 */
  createEffect(name: string, uniforms: Record<string, unknown> = {}): CustomEffect {
    const entry = this.entry(name, 'effect');
    const def = entry.def as EffectDefinition;
    const own: Record<string, THREE.IUniform> = { tDiffuse: { value: null } };
    for (const [key, input] of Object.entries(def.uniforms ?? {})) own[key] = { value: cloneValue(input) };
    for (const [key, value] of Object.entries(uniforms)) {
      if (!(key in own)) throw new Error(`效果「${name}」沒有 uniform「${key}」`);
      own[key].value = value;
    }
    const material = new THREE.ShaderMaterial({
      uniforms: { ...own, ...this.builtins },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: this.effectFragment(def),
    });
    const pass = Object.assign(new ShaderPass(material), { shaderName: name }) as CustomEffect;
    this.track(entry, pass);
    return pass;
  }

  // ───────── 產生原始碼 ─────────

  private uniformBlock(uniforms: Record<string, UniformInput> | undefined): string {
    const lines = ['uniform float uTime;', 'uniform float uDeltaTime;', 'uniform vec2 uResolution;'];
    for (const [key, input] of Object.entries(uniforms ?? {})) lines.push(declaration(key, input));
    return lines.join('\n');
  }

  private unlitVertex(def: ShaderDefinition): string {
    return /* glsl */ `
${this.uniformBlock(def.uniforms)}
varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
${def.vertexHeader ?? ''}
void main() {
  vUv = uv;
  vec3 transformed = position;
  ${def.vertex ?? ''}
  vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}`;
  }

  private unlitFragment(def: ShaderDefinition): string {
    return /* glsl */ `
${this.uniformBlock(def.uniforms)}
varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
${def.fragmentHeader ?? ''}
void main() {
  vec4 color = vec4(1.0);
  ${def.fragment ?? ''}
  gl_FragColor = color;
  ${def.output ?? ''}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
  }

  private effectFragment(def: EffectDefinition): string {
    return /* glsl */ `
uniform sampler2D tDiffuse;
${this.uniformBlock(def.uniforms)}
varying vec2 vUv;
${def.header ?? ''}
void main() {
  vec2 uv = vUv;
  vec4 color = texture2D(tDiffuse, uv);
  ${def.fragment}
  gl_FragColor = color;
}`;
  }

  /** 擴充標準材質：在 three.js 的著色器裡插入程式碼 */
  private patch(
    name: string,
    shader: THREE.WebGLProgramParametersWithUniforms,
    own: Record<string, THREE.IUniform>,
  ): void {
    const def = this.entries.get(name)!.def as ShaderDefinition;
    Object.assign(shader.uniforms, own, this.builtins);
    // physical 材質開啟透射時，three.js 自己會宣告 vWorldPosition，避免重複宣告
    const header =
      `${this.uniformBlock(def.uniforms)}\n` +
      '#ifndef USE_TRANSMISSION\nvarying vec3 vWorldPosition;\n#endif\n' +
      'varying vec3 vWorldNormal;\nvarying vec2 vUv0;\n';

    let vs = `${header}${def.vertexHeader ?? ''}\n${shader.vertexShader}`;
    if (def.vertex) vs = injectAfter(vs, 'begin_vertex', def.vertex, name);
    vs = injectAfter(
      vs,
      'fog_vertex',
      'vUv0 = uv;\nvWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldNormal = normalize(mat3(modelMatrix) * normal);',
      name,
    );
    shader.vertexShader = vs;

    // 標準材質的 vUv 只在有貼圖時存在，這裡用 vUv0 提供，並以巨集讓開發者照樣寫 vUv
    let fs = `${header}#ifndef USE_UV\n#define vUv vUv0\n#endif\n${def.fragmentHeader ?? ''}\n${shader.fragmentShader}`;
    if (def.fragment) fs = injectAfter(fs, 'color_fragment', def.fragment, name);
    if (def.emissive) fs = injectAfter(fs, 'emissivemap_fragment', def.emissive, name);
    if (def.output) fs = injectAfter(fs, 'opaque_fragment', def.output, name);
    shader.fragmentShader = fs;
  }

  // ───────── 內部 ─────────

  private register(name: string, kind: Entry['kind'], def: Entry['def']): void {
    if (this.entries.has(name)) throw new Error(`著色器「${name}」已註冊（要修改請用 update）`);
    this.entries.set(name, { kind, def, version: 0, live: new Set() });
  }

  private entry(name: string, kind: Entry['kind']): Entry {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`找不到著色器「${name}」，已註冊的有：${this.names.join('、') || '（無）'}`);
    if (entry.kind !== kind)
      throw new Error(
        `「${name}」是${entry.kind === 'material' ? '材質' : '效果'}，不是${kind === 'material' ? '材質' : '效果'}`,
      );
    return entry;
  }

  private track(entry: Entry, instance: CustomMaterial | CustomEffect): void {
    entry.live.add(instance);
    const material = 'isMaterial' in instance ? instance : (instance as CustomEffect).material;
    material.addEventListener('dispose', () => entry.live.delete(instance));
  }

  private validate(def: ShaderDefinition): void {
    if (!def.name) throw new Error('著色器需要 name');
    if (def.base !== 'unlit' && !(def.base in BASE_MATERIALS)) throw new Error(`未知的基礎材質「${def.base}」`);
    if (def.emissive && (def.base === 'unlit' || def.base === 'basic')) {
      throw new Error(`著色器「${def.name}」：${def.base} 沒有自發光，請改在 fragment 或 output 裡處理`);
    }
    this.checkUniforms(def.name, def.uniforms);
  }

  private checkUniforms(name: string, uniforms: Record<string, UniformInput> | undefined): void {
    for (const [key, input] of Object.entries(uniforms ?? {})) {
      if ((BUILTIN_UNIFORMS as readonly string[]).includes(key) || key === 'tDiffuse') {
        throw new Error(`著色器「${name}」：uniform 名稱「${key}」是內建的，請換一個名稱`);
      }
      declaration(key, input); // 型別無法推斷時提早報錯
    }
  }
}
