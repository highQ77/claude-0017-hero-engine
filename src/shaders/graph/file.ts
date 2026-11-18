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
import type { ShaderDefinition } from '../ShaderLibrary';
import { type ShaderGraph, compileShaderGraph } from './compile';
import { NODE_DEFS } from './nodes';
import { isObject } from '../../scene/json';

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
    uMouse: new THREE.Vector2(0.5, 0.5),
    uAspect: 1,
    uLightDir: new THREE.Vector3(0.45, 0.75, 0.5).normalize(),
  };
  for (const id of compiled.textures) {
    const n = file.graph.nodes.find((x) => x.id === id);
    const image = String(n?.params.image ?? '');
    uniforms[`uTex${id}`] = textures.get(image ? (file.assets?.[image] ?? '') : '', String(n?.params.wrap ?? 'repeat'));
  }
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
    vertexHeader: compiled.vertexHeader,
    vertex: compiled.vertex,
    fragmentHeader: compiled.fragmentHeader,
    fragment: compiled.fragment,
  };
}

/**
 * 載入節點圖檔，轉成自訂著色器的定義。
 * @param name 著色器名稱（省略時用檔名，例如 shaders/lava.shader.json → lava）
 * @example
 * shaders.define(await loadShaderGraph('shaders/lava.shader.json'));
 * mesh.material = shaders.createMaterial('lava');
 */
export async function loadShaderGraph(url: string, name?: string): Promise<ShaderDefinition> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`載入節點圖 ${url} 失敗：${res.status}`);
  const text = await res.text();
  // 開發伺服器找不到 public 裡的檔案時會回傳網頁
  if (text.trimStart().startsWith('<'))
    throw new Error(`找不到節點圖 ${url}（伺服器回傳的是網頁）：檔名和路徑對嗎？要放在 public/ 底下`);
  const fileName = url.split('/').pop()!.split('?')[0];
  return shaderGraphDefinition(parseShaderGraphFile(text), name ?? fileName.replace(/(\.shader)?\.json$/, ''));
}
