/**
 * 繪製圖層：決定哪台攝影機畫哪些物件（three.js 的 Layers，用名字指定）。
 *
 *   world.add(terrain, RenderLayer, { layers: ['default', 'minimap'] }); // 主畫面和小地圖都看得到
 *   world.add(icon, RenderLayer, { layers: ['minimap'] });               // 只在小地圖上
 *   world.add(mapCam, CameraLayers, { layers: ['minimap'] });           // 小地圖攝影機只畫 minimap 圖層
 *   world.add(mapCam, CameraViewport, { x: 0.75, y: 0.05, width: 0.22, height: 0.3 }); // 畫在右上角
 *
 * - 沒有 RenderLayer 的物件在 'default' 圖層；沒有 CameraLayers 的攝影機只畫 'default'
 * - 燈光預設照亮所有圖層（給燈光 RenderLayer 時只照亮那些圖層）
 * - 圖層名稱第一次用到時自動配一個編號（three.js 最多 32 個，'default' 是 0）
 * - 點選物件（render.pick）只會選到目前攝影機看得到的圖層
 *
 * CameraViewport：主畫面之外，再把這台攝影機畫在畫面的一塊範圍裡（小地圖、後照鏡、子母畫面）。
 * 有 CameraViewport 的攝影機不會被選為主畫面；在主畫面（含後製）之後、2D 介面之前繪製，不套用後製。
 */
import { defineComponent } from '../ecs/Component';

/** RenderLayer 的資料 */
export interface RenderLayerData {
  /** 這個物件在哪些圖層（預設 ['default']） */
  layers: string[];
}

/** 物件所在的繪製圖層（套用到網格、模型、燈光，以及它們的子物件） */
export const RenderLayer = defineComponent<RenderLayerData>('RenderLayer', () => ({ layers: ['default'] }));

/** CameraLayers 的資料 */
export interface CameraLayersData {
  /** 這台攝影機畫哪些圖層（預設 ['default']） */
  layers: string[];
}

/** 攝影機要畫的圖層 */
export const CameraLayers = defineComponent<CameraLayersData>('CameraLayers', () => ({ layers: ['default'] }));

/** CameraViewport 的資料（位置、大小都是畫面的比例 0~1，從左上角算起） */
export interface CameraViewportData {
  /** 左邊的位置（0~1） */
  x: number;
  /** 上邊的位置（0~1，從畫面上方算起） */
  y: number;
  /** 寬（0~1） */
  width: number;
  /** 高（0~1） */
  height: number;
  /** 有好幾個時的順序（小的先畫） */
  order: number;
  /** 背景顏色（'#rrggbb'）；null 代表透明，直接疊在主畫面上 */
  background: string | null;
  /** 是否顯示 */
  enabled: boolean;
}

/** 把攝影機另外畫在畫面的一塊範圍裡（小地圖、後照鏡、子母畫面） */
export const CameraViewport = defineComponent<CameraViewportData>('CameraViewport', () => ({
  x: 0.7,
  y: 0.05,
  width: 0.25,
  height: 0.25,
  order: 0,
  background: '#101210',
  enabled: true,
}));

/** three.js 的圖層數量 */
const MAX_LAYERS = 32;

/**
 * 圖層名稱 → three.js 的圖層編號（render.layers）。名稱第一次用到時自動配編號；'default' 是 0。
 * @example
 * render.layers.mask(['default', 'minimap']); // three.js 的 layers.mask 數值
 */
export class LayerNames {
  private readonly bits = new Map<string, number>([['default', 0]]);

  /**
   * 圖層的編號（第一次用到時配一個新的；超過 32 個時丟出錯誤）
   * @param name 圖層名稱
   */
  bit(name: string): number {
    let b = this.bits.get(name);
    if (b === undefined) {
      if (this.bits.size >= MAX_LAYERS)
        throw new Error(`繪製圖層最多 ${MAX_LAYERS} 個（three.js 的限制），「${name}」放不下：請合併一些圖層`);
      b = this.bits.size;
      this.bits.set(name, b);
    }
    return b;
  }

  /**
   * 幾個圖層合起來的 mask（three.js Layers.mask）
   * @param names 圖層名稱
   */
  mask(names: readonly string[]): number {
    let m = 0;
    for (const n of names) m |= 1 << this.bit(n);
    return m >>> 0;
  }

  /** 已經用到的圖層名稱（依編號） */
  names(): string[] {
    return [...this.bits.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n);
  }
}

/** 所有圖層（燈光預設用這個：照亮所有攝影機看到的物件） */
export const ALL_LAYERS = 0xffffffff >>> 0;
