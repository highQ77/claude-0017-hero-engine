/**
 * webgl2d.js 的型別：以 WebGL 實作、和 CanvasRenderingContext2D 介面相同的 2D 繪圖 API。
 * 引擎裡透過 <UICanvas> 使用：ui.require<UICanvas>('id').getContext()。
 */

/** 自訂濾鏡 uniform 的值：數字、陣列（vec2～vec4）、布林、CSS 顏色字串（vec3／vec4）或影像（sampler2D） */
export type ShaderUniformValue = number | boolean | string | readonly number[] | Float32Array | CanvasImageSource;

/** 自訂 GLSL 濾鏡（ctx.createShaderFilter 建立）；可以放進 ctx.filter 或傳給 ctx.applyFilter */
export declare class ShaderFilter {
  /** GLSL 原始碼（需定義 vec4 effect(vec2 uv)，回傳預乘 alpha 的顏色） */
  readonly source: string;
  /** 目前的 uniform 值 */
  uniforms: Record<string, ShaderUniformValue>;
  /** 設定 uniform，回傳自己（可以串接） */
  setUniform(name: string, value: ShaderUniformValue): this;
  /** shader 裡宣告的 uniform 名稱（不含內建的 u_src、u_resolution、u_size、u_pixelRatio） */
  readonly uniformNames: string[];
  /** 釋放 GPU 資源 */
  dispose(): void;
}

/** 濾鏡值：CSS filter 字串、自訂濾鏡，或兩者混合的陣列（依序套用） */
export type WebGL2DFilter = string | ShaderFilter | readonly (string | ShaderFilter)[];

/** 建立 context 的選項 */
export interface WebGL2DOptions {
  /** 畫布是否有透明通道（預設 true） */
  alpha?: boolean;
  /** MSAA 反鋸齒（預設 true） */
  antialias?: boolean;
  /** 每個繪圖座標單位對應的實體像素數；'auto' 使用 devicePixelRatio（預設 1） */
  pixelRatio?: number | 'auto';
  /** false 時強制使用 WebGL 1（預設 true） */
  webgl2?: boolean;
  /** 保留畫面內容（Canvas 2D 語意，預設 true）；false 較快，但每格都必須整個重畫 */
  preserveDrawingBuffer?: boolean;
  /** 直接傳給 WebGL */
  desynchronized?: boolean;
  /** 直接傳給 WebGL */
  powerPreference?: WebGLPowerPreference;
}

/** 高解析度 context 的選項 */
export interface WebGL2DHiDPIOptions extends Omit<WebGL2DOptions, 'pixelRatio'> {
  /** CSS 寬度（預設為 canvas 目前的 width） */
  width?: number;
  /** CSS 高度（預設為 canvas 目前的 height） */
  height?: number;
  /** 預設 devicePixelRatio */
  pixelRatio?: number;
  /** 是否設定 canvas.style 的寬高（預設 true） */
  setStyle?: boolean;
}

/** WebGL 版的 2D 繪圖 context：方法、屬性與 CanvasRenderingContext2D 相同，另外有 WebGL2D 專屬的擴充 */
export interface WebGL2DRenderingContext
  extends Omit<CanvasRenderingContext2D, 'canvas' | 'filter' | 'getContextAttributes'> {
  /** 繪圖的畫布 */
  readonly canvas: HTMLCanvasElement;
  /** 底層的 WebGL context */
  readonly gl: WebGLRenderingContext | WebGL2RenderingContext;
  /** 是否使用 WebGL 2（否則是 WebGL 1） */
  readonly isWebGL2: boolean;
  /** 每個繪圖座標單位對應幾個實體像素；改變後座標系統立即生效，不會重新取樣既有內容 */
  pixelRatio: number;
  /** CSS filter 字串、ShaderFilter，或兩者混合的陣列（依序套用）；無效的值會被忽略 */
  filter: string | ShaderFilter | (string | ShaderFilter)[];
  /** 和原生相同的欄位 */
  getContextAttributes(): CanvasRenderingContext2DSettings;
  /** 編譯自訂濾鏡：source 需定義 vec4 effect(vec2 uv)，回傳預乘 alpha 的顏色 */
  createShaderFilter(source: string, uniforms?: Record<string, ShaderUniformValue>): ShaderFilter;
  /** 對畫布上已有的內容套用濾鏡（不受變換影響；受裁切影響）。矩形以 CSS 像素計，預設為整個畫布 */
  applyFilter(filter: WebGL2DFilter, x?: number, y?: number, w?: number, h?: number): void;
}

/** WebGL2D 的 Path2D（和原生 Path2D 介面相同；也可以用 SVG 路徑字串建立） */
export declare class WebGL2DPath2D implements Path2D {
  constructor(path?: Path2D | WebGL2DPath2D | string);
  addPath(path: Path2D | WebGL2DPath2D, transform?: DOMMatrix2DInit): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void;
  rect(x: number, y: number, w: number, h: number): void;
  roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii?: number | DOMPointInit | (number | DOMPointInit)[],
  ): void;
}

declare const WebGL2D: {
  readonly version: string;
  /** 取得（或建立）canvas 的 WebGL2D context；同一個 canvas 重複呼叫會回傳同一個物件 */
  getContext(canvas: HTMLCanvasElement, options?: WebGL2DOptions): WebGL2DRenderingContext;
  /** 高解析度 context：backing store = CSS 尺寸 × devicePixelRatio，繪圖座標仍是 CSS 像素 */
  getContextHiDPI(canvas: HTMLCanvasElement, options?: WebGL2DHiDPIOptions): WebGL2DRenderingContext;
  /** 讓 canvas.getContext('webgl-2d') 回傳 WebGL2D context */
  install(): void;
  readonly WebGL2DRenderingContext: new (
    canvas: HTMLCanvasElement,
    options?: WebGL2DOptions,
  ) => WebGL2DRenderingContext;
  readonly Path2D: typeof WebGL2DPath2D;
  readonly CanvasGradient: new (...args: never[]) => CanvasGradient;
  readonly CanvasPattern: new (...args: never[]) => CanvasPattern;
  readonly ShaderFilter: typeof ShaderFilter;
};
export default WebGL2D;
