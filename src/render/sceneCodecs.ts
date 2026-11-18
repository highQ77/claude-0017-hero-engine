/**
 * 繪製元件的場景檔存讀規則：MeshRenderer、Camera、Light（RenderPlugin 安裝時登記）。
 * SceneObject 放的是程式建立的 three.js 物件，不能存成檔案（模型之後由資源模組處理）。
 */
import { plainCodec, type ComponentCodec } from '../scene/SceneFile';
import { Camera, Light, MeshRenderer, type MeshRendererData } from './components';
import { CameraLayers, CameraViewport, RenderLayer } from './Layers';
import type { ComponentType } from '../ecs/Component';
import { isGeometryDesc, isMaterialDesc } from './descriptors';
import { isPlainJson } from '../scene/json';

const meshFlags = plainCodec(MeshRenderer, { skip: ['geometry', 'material'] });

/**
 * MeshRenderer：{ geometry: 幾何描述, material: 材質描述, castShadow, receiveShadow, visible, renderOrder }。
 * 幾何、材質要是描述（例如 { box: 1 }、'#f80'）；程式給的 three.js 物件不能存。
 */
export const meshRendererCodec: ComponentCodec<MeshRendererData> = {
  type: MeshRenderer,
  read(data, ctx) {
    if (data === null || data === undefined) return {};
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error('要是物件 { geometry, material, … }');
    const { geometry, material, ...rest } = data as Record<string, unknown>;
    const out: Partial<MeshRendererData> = meshFlags.read(rest, ctx);
    if (geometry !== undefined && geometry !== null) {
      if (!isGeometryDesc(geometry) || Array.isArray(geometry) || !isPlainJson(geometry))
        throw new Error(`geometry 要是幾何描述，例如 { "box": 1 }，收到 ${JSON.stringify(geometry)}`);
      out.geometry = geometry;
    }
    if (material !== undefined && material !== null) {
      if (!isMaterialDesc(material) || !isPlainJson(material))
        throw new Error(
          `material 要是材質描述，例如 "#ff8800" 或 { "standard": { … } }，收到 ${JSON.stringify(material)}`,
        );
      out.material = material;
    }
    return out;
  },
  write(value) {
    const { geometry, material } = value;
    if (geometry !== null && !isPlainJson(geometry)) return undefined;
    if (material !== null && !isPlainJson(material)) return undefined;
    const out = meshFlags.write(value) as Record<string, unknown>;
    return { ...(geometry !== null ? { geometry } : {}), ...(material !== null ? { material } : {}), ...out };
  },
};

/** Camera：fov、near、far、size、zoom、priority、enabled、kind（perspective／orthographic） */
export const cameraCodec = plainCodec(Camera, { choices: { kind: ['perspective', 'orthographic'] } });

/** Light：kind、color（'#rrggbb'）、intensity…；angle 用度 */
export const lightCodec = plainCodec(Light, {
  colors: ['color', 'groundColor'],
  angles: ['angle'],
  choices: { kind: ['ambient', 'hemisphere', 'directional', 'point', 'spot'] },
});

/**
 * 圖層清單的存讀規則：檔案裡寫 { layers: 'default minimap' }（用空白或逗號隔開；陣列也可以），名稱是英數字、- _。
 * 存檔時寫成用空白隔開的文字（XML 裡就是 layers="default minimap"）。
 */
function layersCodec(type: ComponentType<{ layers: string[] }>): ComponentCodec<{ layers: string[] }> {
  return {
    type,
    read(data) {
      if (data === null || data === undefined) return {};
      if (typeof data !== 'object' || Array.isArray(data)) throw new Error('要是物件 { layers: [圖層名稱…] }');
      const { layers, ...rest } = data as Record<string, unknown>;
      const extra = Object.keys(rest);
      if (extra.length) throw new Error(`不認識的欄位「${extra[0]}」（可用：layers）`);
      if (layers === undefined) return {};
      const list = typeof layers === 'string' ? layers.split(/[\s,]+/).filter(Boolean) : layers;
      if (!Array.isArray(list) || !list.every((l) => typeof l === 'string' && /^[\w-]+$/.test(l)))
        throw new Error(`layers 要是圖層名稱（英數字、- _，用空白隔開），收到 ${JSON.stringify(layers)}`);
      return { layers: [...list] };
    },
    write(value) {
      const same = value.layers.length === 1 && value.layers[0] === 'default';
      return same ? {} : { layers: value.layers.join(' ') };
    },
  };
}

/** RenderLayer：{ layers: ['default', 'minimap'] } */
export const renderLayerCodec = layersCodec(RenderLayer);
/** CameraLayers：{ layers: ['minimap'] } */
export const cameraLayersCodec = layersCodec(CameraLayers);
/** CameraViewport：x、y、width、height（畫面比例 0~1，從左上角）、order、background（'#rrggbb' 或 null）、enabled */
export const cameraViewportCodec = plainCodec(CameraViewport, { nullable: ['background'] });

/** 繪製模組提供的所有存讀規則 */
export const renderCodecs: readonly ComponentCodec<never>[] = [
  meshRendererCodec,
  cameraCodec,
  lightCodec,
  renderLayerCodec,
  cameraLayersCodec,
  cameraViewportCodec,
] as unknown as ComponentCodec<never>[];
