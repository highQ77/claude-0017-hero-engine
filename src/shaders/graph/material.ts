/**
 * 材質描述 { shaderGraph: 'shaders/lava.shader.json' }：場景檔、MeshRenderer 直接用節點圖檔當材質
 * （ShaderPlugin 安裝時向繪製模組登記）。
 *
 * - 材質立刻建立（先不顯示），節點圖載入後才填入著色器並顯示
 * - 同一個網址的描述共用同一個材質（繪製模組依描述共用）
 * - 開發時在著色器編輯器存檔：開著的遊戲、3D 場景編輯器裡用到那個檔案的材質會自動更新
 */
import type * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { createLogger } from '../../core/Logger';
import type { ShaderLibrary } from '../ShaderLibrary';
import { loadShaderGraph } from './file';

const log = createLogger('shaders');

interface GraphMaterialState {
  library: ShaderLibrary;
  url: string;
  /** 目前填進來的材質（ShaderLibrary 建立的；換內容時釋放） */
  inner: THREE.Material | null;
  /** 第幾次載入（舊的載入晚到時不套用） */
  version: number;
}

/** 節點圖材質（節點材質；載入完成前不顯示） */
type GraphMaterial = MeshBasicNodeMaterial & { uniforms?: Record<string, unknown> };

const states = new WeakMap<GraphMaterial, GraphMaterialState>();
/** 網址 → 用到它的材質（存檔後重新載入） */
const byUrl = new Map<string, Set<GraphMaterial>>();

/** 網址整理成相對於 public 的寫法（shaders/lava.shader.json） */
const normalize = (url: string) => url.replace(/^\.?\//, '');

async function fill(material: GraphMaterial): Promise<void> {
  const st = states.get(material);
  if (!st) return;
  const version = ++st.version;
  try {
    const def = await loadShaderGraph(st.url);
    if (version !== st.version || !states.has(material)) return; // 已經有更新的載入，或材質已釋放
    const inner = st.library.createFromDefinition(def) as unknown as GraphMaterial;
    // 換成節點圖的節點（uniform 節點是同一份：改 material.uniforms 一樣有效）
    material.positionNode = inner.positionNode;
    material.colorNode = inner.colorNode;
    material.outputNode = inner.outputNode;
    material.uniforms = inner.uniforms;
    material.transparent = inner.transparent;
    material.depthWrite = inner.depthWrite;
    material.side = inner.side;
    material.toneMapped = inner.toneMapped;
    material.visible = true;
    material.needsUpdate = true;
    st.inner?.dispose();
    st.inner = inner;
  } catch (error) {
    log.warn(`節點圖材質 ${st.url} 載入失敗：${(error as Error).message}`);
  }
}

/**
 * 用節點圖檔建立材質（材質描述 { shaderGraph: 網址 } 用這個；一般程式用 loadShaderGraph + shaders.createMaterial）。
 * 回傳的材質立刻可以用，節點圖載入完成前不顯示。
 */
export function shaderGraphMaterial(library: ShaderLibrary, url: string): THREE.Material {
  const path = normalize(url);
  const material: GraphMaterial = new MeshBasicNodeMaterial({ visible: false });
  Object.assign(material, { shaderName: path });
  states.set(material, { library, url: path, inner: null, version: 0 });
  let set = byUrl.get(path);
  if (!set) byUrl.set(path, (set = new Set()));
  set.add(material);
  material.addEventListener('dispose', () => {
    const st = states.get(material);
    st?.inner?.dispose();
    states.delete(material);
    byUrl.get(path)?.delete(material);
  });
  void fill(material);
  return material;
}

/** 重新載入用到這個節點圖檔的材質（開發時存檔後自動呼叫） */
export function reloadShaderGraphMaterials(url: string): void {
  for (const m of byUrl.get(normalize(url)) ?? []) void fill(m);
}

// Vite 開發伺服器：tools/shader-files-plugin.ts 在節點圖檔存檔時送出（打包後整段會被去掉）
if (import.meta.hot) {
  import.meta.hot.on('hero:file-changed', (data: { path: string }) => {
    if (data.path.endsWith('.shader.json')) reloadShaderGraphMaterials(data.path);
  });
}
