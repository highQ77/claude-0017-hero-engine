/**
 * 節點圖檔（著色器編輯器存在專案的 public/shaders/<名稱>.shader.json）與遊戲裡的使用方式：
 *
 *   const def = await loadShaderGraph('shaders/lava.shader.json');   // 名稱預設是檔名（lava）
 *   shaders.define(def);
 *   mesh.material = shaders.createMaterial('lava');
 *
 * 檔案格式：
 *   { "format": "hero-shader-graph", "version": 1,
 *     "graph": { "nodes": [...], "links": [...], "nextId": 12 },
 *     "assets": { "img_xxx": "data:image/png;base64,…" },   // 貼圖節點的圖片（縮到最長邊 1024px）
 *     "preview": { "mesh": "sphere" } }                     // 編輯器的預覽設定（遊戲不用）
 * 也讀得懂 Shader Composer 匯出的 JSON（format: 'shader-node-editor'）。
 */
import * as THREE from 'three';
import type { EffectDefinition, ShaderDefinition } from '../ShaderLibrary';
import { type CompiledShaderGraph, type ShaderGraph, compileShaderGraph, shaderGraphKind } from './compile';
import { type ShaderNode, tsl } from '../tsl';

const { max, sRGBTransferEOTF, vec3, vec4 } = tsl;
import { NODE_DEFS } from './nodes';
import { isObject } from '../../scene/json';
import { readPackedFile } from '../../core/packedFiles';

/** 節點圖檔 */
export interface ShaderGraphFile {
  /** 格式名稱 */
  format: 'hero-shader-graph';
  /** 格式版本 */
  version: 1;
  /** 節點圖 */
  graph: ShaderGraph;
  /** 圖片：編號 → data URL */
  assets?: Record<string, string>;
  /** 編輯器的預覽設定（遊戲不用） */
  preview?: { mesh?: string };
}

/** 節點圖檔的格式名稱 */
export const SHADER_GRAPH_FORMAT = 'hero-shader-graph';

/**
 * 整理節點圖：去掉未知的節點、指向不存在節點的連線，補上預設值。
 * 格式不正確（沒有 nodes、links 陣列）時丟出錯誤。
 */
export function normalizeShaderGraph(g: unknown): ShaderGraph {
  if (!isObject(g) || !Array.isArray(g.nodes) || !Array.isArray(g.links))
    throw new Error('節點圖格式不正確：需要 nodes、links 陣列');
  const nodes = (g.nodes as Record<string, unknown>[])
    .filter((n) => isObject(n) && typeof n.type === 'string' && NODE_DEFS[n.type])
    .map((n) => {
      const def = NODE_DEFS[n.type as string];
      const values: Record<string, number> = {};
      const params: Record<string, string | number> = {};
      for (const i of def.inputs) if (i.default !== undefined) values[i.name] = i.default;
      for (const p of def.params) params[p.name] = p.default;
      return {
        id: Number(n.id),
        type: n.type as string,
        x: Number(n.x) || 0,
        y: Number(n.y) || 0,
        values: Object.assign(values, isObject(n.values) ? n.values : {}),
        params: Object.assign(params, isObject(n.params) ? n.params : {}),
        preview: n.preview !== false,
      };
    });
  const ids = new Set(nodes.map((n) => n.id));
  const links = (g.links as Record<string, unknown>[])
    .filter((l) => isObject(l) && ids.has(Number(l.from)) && ids.has(Number(l.to)))
    .map((l) => ({ from: Number(l.from), fromPort: String(l.fromPort), to: Number(l.to), toPort: String(l.toPort) }));
  return { nodes, links, nextId: Math.max(0, ...nodes.map((n) => n.id)) + 1 };
}

/** 讀取節點圖檔的內容（JSON 文字或已經解析的物件）；也接受 Shader Composer 匯出的格式 */
export function parseShaderGraphFile(input: string | unknown): ShaderGraphFile {
  const data = typeof input === 'string' ? (JSON.parse(input) as unknown) : input;
  if (!isObject(data)) throw new Error('節點圖檔要是 JSON 物件');
  const assets: Record<string, string> = {};
  if (isObject(data.assets)) for (const [k, v] of Object.entries(data.assets)) if (typeof v === 'string') assets[k] = v;
  const preview = isObject(data.preview)
    ? { mesh: typeof data.preview.mesh === 'string' ? data.preview.mesh : undefined }
    : undefined;
  return {
    format: SHADER_GRAPH_FORMAT,
    version: 1,
    graph: normalizeShaderGraph(data.graph ?? data),
    assets,
    ...(preview ? { preview } : {}),
  };
}

/** 節點圖檔轉成文字（只保留用到的圖片） */
export function stringifyShaderGraphFile(file: ShaderGraphFile): string {
  const used: Record<string, string> = {};
  for (const n of file.graph.nodes) {
    const id = n.params?.image;
    if (typeof id === 'string' && id && file.assets?.[id]) used[id] = file.assets[id];
  }
  return `${JSON.stringify({ ...file, format: SHADER_GRAPH_FORMAT, version: 1, assets: used }, null, 2)}\n`;
}

// ───────── 貼圖 ─────────

const WRAP: Record<string, THREE.Wrapping> = {
  repeat: THREE.RepeatWrapping,
  clamp: THREE.ClampToEdgeWrapping,
  mirror: THREE.MirroredRepeatWrapping,
};

let uvGrid: HTMLCanvasElement | null = null;
/** 內建的 UV 測試格線（貼圖節點沒有圖片時用） */
export function builtinUVGrid(): HTMLCanvasElement {
  if (uvGrid) return uvGrid;
  const size = 512;
  const cells = 8;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const s = size / cells;
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++) {
      const hue = (x / cells) * 300;
      const light = 38 + (y / cells) * 30 + ((x + y) % 2) * 8;
      g.fillStyle = `hsl(${hue}, 70%, ${light}%)`;
      g.fillRect(x * s, y * s, s, s);
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.font = `bold ${s * 0.3}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String.fromCharCode(65 + x) + (cells - y), x * s + s / 2, y * s + s / 2);
    }
  g.strokeStyle = 'rgba(255,255,255,.55)';
  g.lineWidth = 2;
  for (let i = 0; i <= cells; i++) {
    g.beginPath();
    g.moveTo(i * s, 0);
    g.lineTo(i * s, size);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * s);
    g.lineTo(size, i * s);
    g.stroke();
  }
  uvGrid = c;
  return c;
}

/** 貼圖快取：同一張圖片、同一種環繞方式共用一個貼圖 */
export class ShaderGraphTextures {
  private readonly cache = new Map<string, THREE.Texture>();

  /** 取得貼圖；url 空白時是內建 UV 格線；圖片載入完成前是空的貼圖 */
  get(url: string, wrap: string): THREE.Texture {
    const key = `${url || 'builtin'}|${wrap}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    let tex: THREE.Texture;
    if (!url) tex = new THREE.CanvasTexture(builtinUVGrid());
    else tex = new THREE.TextureLoader().load(url);
    // 節點圖的顏色是畫面上的顏色：圖片不做色彩轉換（和編輯器的預覽一樣）
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = WRAP[wrap] ?? THREE.RepeatWrapping;
    this.cache.set(key, tex);
    return tex;
  }

  /** 釋放所有貼圖 */
  dispose(): void {
    for (const t of this.cache.values()) t.dispose();
    this.cache.clear();
  }
}

let sharedTextures: ShaderGraphTextures | null = null;

/** shaderGraphDefinition 的選項 */
export interface ShaderGraphDefinitionOptions {
  /** 只預覽某個節點的某個輸出（編輯器的節點縮圖用） */
  target?: { nodeId: number; port: string };
  /** 貼圖快取（省略時用共用的） */
  textures?: ShaderGraphTextures;
  /**
   * 全螢幕效果的圖：當成「畫面」的圖（編輯器預覽用；省略時用內建 UV 格線）。
   * 效果的圖用 shaderGraphDefinition 會得到一個材質：在平面上顯示效果套用在這張圖上的樣子
   */
  screen?: THREE.Texture;
  /** Time 節點的值（省略時是經過的秒數；著色器編輯器傳自己的 uniform，才能暫停） */
  time?: ShaderNode;
}

/** 節點圖的 uniform：uMouse、uLightDir（全螢幕效果的 uAspect 由畫面大小算出）、每個貼圖節點的 uTex<編號> */
function graphUniforms(
  file: ShaderGraphFile,
  compiled: CompiledShaderGraph,
  textures: ShaderGraphTextures,
): Record<string, THREE.Vector2 | THREE.Vector3 | number | THREE.Texture> {
  const uniforms: Record<string, THREE.Vector2 | THREE.Vector3 | number | THREE.Texture> = {
    uMouse: new THREE.Vector2(0.5, 0.5),
    uLightDir: new THREE.Vector3(0.45, 0.75, 0.5).normalize(),
  };
  for (const id of compiled.textures) {
    const n = file.graph.nodes.find((x) => x.id === id);
    const image = String(n?.params.image ?? '');
    uniforms[`uTex${id}`] = textures.get(image ? (file.assets?.[image] ?? '') : '', String(n?.params.wrap ?? 'repeat'));
  }
  return uniforms;
}

/**
 * 節點圖檔轉成自訂著色器的定義（base: 'unlit'），交給 shaders.define 註冊。
 * uniform：uMouse（vec2，預設 0.5, 0.5）、uAspect（float，預設 1）、uLightDir（vec3）、每個貼圖節點的 uTex<編號>；
 * 建立材質後可以修改，例如 material.uniforms.uLightDir.value.copy(sun.direction)。
 * @example
 * shaders.define(shaderGraphDefinition(parseShaderGraphFile(json), 'lava'));
 */
export function shaderGraphDefinition(
  file: ShaderGraphFile,
  name: string,
  options: ShaderGraphDefinitionOptions = {},
): ShaderDefinition {
  const compiled = compileShaderGraph(file.graph, { target: options.target });
  const textures = options.textures ?? (sharedTextures ??= new ShaderGraphTextures());
  const uniforms: NonNullable<ShaderDefinition['uniforms']> = {
    uAspect: 1,
    ...graphUniforms(file, compiled, textures),
  };
  const effect = compiled.kind === 'effect';
  if (effect) uniforms.uScreen = options.screen ?? textures.get('', 'clamp');
  return {
    name,
    base: 'unlit',
    uniforms,
    options: {
      toneMapped: false, // 節點圖的顏色就是最後的顏色，不套用色調映射
      transparent: compiled.transparent,
      depthWrite: !compiled.transparent,
      side: compiled.side,
    },
    position: compiled.position ? (c) => compiled.position!({ uniforms: c.uniforms, time: options.time }) : undefined,
    color: (c) => {
      // 全螢幕效果當成平面材質預覽：畫面 = screen 這張圖（畫面上的顏色）
      const env = effect
        ? {
            uniforms: c.uniforms,
            uv: c.uv,
            screen: (uv: ShaderNode) => c.uniforms.uScreen.sample(uv),
            time: options.time,
          }
        : { uniforms: c.uniforms, time: options.time };
      const color = compiled.color(env);
      // 只預覽一個節點、或全螢幕效果的圖：顏色是畫面上的值，材質會從線性轉回 sRGB，所以先轉成線性
      return options.target || effect ? vec4(sRGBTransferEOTF(max(color.rgb, vec3(0))), color.a) : color;
    },
  };
}

/**
 * 全螢幕效果的節點圖（有 Effect Output）轉成效果的定義，交給 shaders.defineEffect 註冊，
 * 再用 shaders.createEffect 建立、postfx.addPass(effect, 'display') 加進後製（或寫在 postfx.settings.effects）。
 * uniform：uMouse（vec2）、uLightDir（vec3）、每個貼圖節點的 uTex<編號>；寬高比由畫面大小算出。
 * @example
 * shaders.defineEffect(shaderGraphEffectDefinition(parseShaderGraphFile(json), 'crt'));
 * postfx.addPass(shaders.createEffect('crt'), 'display');
 */
export function shaderGraphEffectDefinition(
  file: ShaderGraphFile,
  name: string,
  options: Pick<ShaderGraphDefinitionOptions, 'textures'> = {},
): EffectDefinition {
  const compiled = compileShaderGraph(file.graph);
  if (compiled.kind !== 'effect')
    throw new Error(`節點圖「${name}」是材質（Fragment Output），不是全螢幕效果：效果的圖要用 Effect Output`);
  const textures = options.textures ?? (sharedTextures ??= new ShaderGraphTextures());
  return {
    name,
    uniforms: graphUniforms(file, compiled, textures),
    color: (c) => compiled.color({ uniforms: c.uniforms, uv: c.uv, screen: c.sample }),
  };
}

/**
 * 載入全螢幕效果的節點圖檔，轉成效果的定義。
 * @param name 效果名稱（省略時用檔名，例如 shaders/crt.shader.json → crt）
 * @example
 * shaders.defineEffect(await loadShaderGraphEffect('shaders/crt.shader.json'));
 * postfx.addPass(shaders.createEffect('crt'), 'display');
 */
export async function loadShaderGraphEffect(url: string, name?: string): Promise<EffectDefinition> {
  const { file, fileName } = await fetchGraphFile(url);
  return shaderGraphEffectDefinition(file, name ?? fileName.replace(/(\.shader)?\.json$/, ''));
}

/** 下載並解析節點圖檔 */
async function fetchGraphFile(url: string): Promise<{ file: ShaderGraphFile; fileName: string }> {
  // 打包時保護過的檔案（shaders/*.json）：用到才解開；其他照常下載
  let text = await readPackedFile(url);
  if (text === null) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`載入節點圖 ${url} 失敗：${res.status}`);
    text = await res.text();
  }
  // 開發伺服器找不到 public 裡的檔案時會回傳網頁
  if (text.trimStart().startsWith('<'))
    throw new Error(`找不到節點圖 ${url}（伺服器回傳的是網頁）：檔名和路徑對嗎？要放在 public/ 底下`);
  return { file: parseShaderGraphFile(text), fileName: url.split('/').pop()!.split('?')[0] };
}

/**
 * 載入節點圖檔，轉成自訂著色器的定義。
 * @param name 著色器名稱（省略時用檔名，例如 shaders/lava.shader.json → lava）
 * @example
 * shaders.define(await loadShaderGraph('shaders/lava.shader.json'));
 * mesh.material = shaders.createMaterial('lava');
 */
export async function loadShaderGraph(url: string, name?: string): Promise<ShaderDefinition> {
  const { file, fileName } = await fetchGraphFile(url);
  if (shaderGraphKind(file.graph) === 'effect')
    throw new Error(`節點圖 ${url} 是全螢幕效果（Effect Output），不是材質：請用 loadShaderGraphEffect`);
  return shaderGraphDefinition(file, name ?? fileName.replace(/(\.shader)?\.json$/, ''));
}
