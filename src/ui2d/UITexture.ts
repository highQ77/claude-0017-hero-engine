import * as THREE from 'three';
import type { UIRenderer } from './CanvasRenderer';
import type { UI2D } from './UI2D';
import { UIPainter, type Context2D } from './UIPainter';
import type { Rect } from './elements';

const makeCanvas = (): HTMLCanvasElement | OffscreenCanvas =>
  typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');

/**
 * 介面畫布放在哪裡：
 * - gpu：瀏覽器預設（Chrome 的 2D 畫布在 GPU 上，複製到 WebGL 貼圖是 GPU 內部複製，很快）
 * - cpu：畫布放在記憶體（willReadFrequently），變動的範圍用像素資料上傳。
 *   Safari 的 2D 畫布在 GPU 上，複製到 WebGL 貼圖時要先從 GPU 讀回來並等待；如果在 Safari 上
 *   介面變動時（效能面板的「介面」一行）重畫時間很長，可以試試 cpu。Chrome 上 cpu 比較慢（實測約 2 倍）。
 * - auto：WebKit（Safari、iOS 上所有瀏覽器）用 cpu，其他用 gpu
 * 預設 gpu（還沒有在 Safari 上量測過 cpu 是否比較快）。
 */
export type UICanvasMode = 'auto' | 'cpu' | 'gpu';

/** 這個瀏覽器是不是 WebKit（Safari；iOS 上的 Chrome、Firefox 也是 WebKit） */
export function isWebKit(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /AppleWebKit\//.test(ua) && !/(Chrome|Chromium|Edg|OPR)\//.test(ua);
}

/** 介面重畫的統計（效能面板用） */
export interface UIRenderStats {
  /** 完整上傳、局部上傳的次數，局部上傳的像素數 */
  full: number;
  /** 局部上傳的次數 */
  partial: number;
  /** 局部上傳的總像素數 */
  partialPixels: number;
  /** 重畫（含上傳）的次數與累計毫秒 */
  renders: number;
  /** 重畫花的總時間（毫秒） */
  ms: number;
  /** 單次重畫最久的毫秒（讀取的人可以歸零） */
  peakMs: number;
  /** 實際使用的畫布模式 */
  mode: 'cpu' | 'gpu';
}

/**
 * 把介面畫在畫布上，並維護對應的 GPU 貼圖。
 * 介面有變動時才重畫；只有一小塊變動時只重畫、只上傳那一塊（避免整張大貼圖上傳造成卡頓）。
 * 2D 疊加層（UIPlugin）與 3D 面板（UI3D）共用。
 */
export class UITextureRenderer implements UIRenderer {
  /** 繪製介面的畫布 */
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** 介面的貼圖（three.js） */
  readonly texture: THREE.CanvasTexture;
  /** 預設的畫布模式（建立之前設定才有效） */
  static canvasMode: UICanvasMode = 'gpu';
  /** 統計：上傳次數、重畫時間（效能分析用） */
  readonly uploadStats: UIRenderStats;
  /** cpu 模式：畫布在記憶體，局部更新直接上傳像素資料 */
  private readonly cpu: boolean;
  private readonly ctx: Context2D;
  private ui: UI2D | null = null;
  private painter: UIPainter | null = null;
  /** GPU 上已經有完整的貼圖（之後才能局部上傳） */
  private uploaded = false;
  private readonly patch: HTMLCanvasElement | OffscreenCanvas;
  private readonly patchCtx: Context2D;
  private readonly patchPosition = new THREE.Vector2();

  /**
   * @param gl 取得 WebGL 繪製器（沒有時改為每次整張上傳，例如測試環境）
   * @param onRendered 畫布更新後呼叫（例如遊戲暫停時補畫一次 3D 畫面）
   */
  constructor(
    private readonly gl: () => THREE.WebGLRenderer | null,
    private readonly onRendered?: (ui: UI2D) => void,
  ) {
    const mode = UITextureRenderer.canvasMode;
    this.cpu = mode === 'auto' ? isWebKit() : mode === 'cpu';
    this.uploadStats = {
      full: 0,
      partial: 0,
      partialPixels: 0,
      renders: 0,
      ms: 0,
      peakMs: 0,
      mode: this.cpu ? 'cpu' : 'gpu',
    };
    this.canvas = makeCanvas();
    this.ctx = this.canvas.getContext('2d', this.cpu ? { willReadFrequently: true } : undefined) as Context2D;
    this.texture = new THREE.CanvasTexture(this.canvas as HTMLCanvasElement);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.patch = makeCanvas();
    this.patchCtx = this.patch.getContext('2d') as Context2D;
  }

  /** 連接到介面 */
  attach(ui: UI2D): void {
    this.ui = ui;
    this.painter = new UIPainter((url) => ui.imageSource(url));
  }

  /** 重畫並上傳到貼圖 */
  render(): void {
    const started = performance.now();
    const before = this.uploadStats.full + this.uploadStats.partial;
    this.paintAndUpload();
    // 只統計真的有重畫的次數
    if (this.uploadStats.full + this.uploadStats.partial !== before) {
      const ms = performance.now() - started;
      this.uploadStats.renders++;
      this.uploadStats.ms += ms;
      this.uploadStats.peakMs = Math.max(this.uploadStats.peakMs, ms);
    }
  }

  private paintAndUpload(): void {
    const ui = this.ui;
    if (!ui || !this.painter) return;
    const { width, height } = ui.size;
    const pr = ui.pixelRatio;
    const w = Math.max(1, Math.round(width * pr));
    const h = Math.max(1, Math.round(height * pr));
    let regions = ui.consumeDamage();
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.texture.dispose(); // 尺寸改變：重新配置 GPU 貼圖
      this.uploaded = false;
      regions = null;
    }
    if (!ui.root) {
      this.onRendered?.(ui);
      return;
    }
    if (regions && regions.length === 0) return; // 沒有變化

    const gl = this.gl();
    if (regions && this.uploaded && gl) {
      for (const r of regions) {
        this.painter.paint(this.ctx, ui.root, width, height, pr, ui.paintState, r);
        this.uploadRegion(gl, r, pr);
      }
    } else {
      this.painter.paint(this.ctx, ui.root, width, height, pr, ui.paintState);
      this.texture.needsUpdate = true;
      if (gl) {
        // 立刻上傳，之後才能用局部上傳更新它
        gl.initTexture(this.texture);
        this.uploaded = true;
      }
      this.uploadStats.full++;
    }
    this.onRendered?.(ui);
  }

  /**
   * 把畫布上的某個範圍上傳到 GPU 貼圖的對應位置：
   * gpu 模式複製到小畫布再上傳；cpu 模式直接讀出像素資料上傳（不經過畫布，Safari 不用等 GPU 讀回）
   */
  private uploadRegion(gl: THREE.WebGLRenderer, r: Rect, pr: number): void {
    const x = Math.max(0, Math.floor(r.x * pr));
    const y = Math.max(0, Math.floor(r.y * pr));
    const w = Math.min(this.canvas.width, Math.ceil((r.x + r.width) * pr)) - x;
    const h = Math.min(this.canvas.height, Math.ceil((r.y + r.height) * pr)) - y;
    if (w <= 0 || h <= 0) return;
    // 貼圖是上下翻轉存放（flipY），目的地的 y 要從底部算（像素資料上傳時 WebGL 一樣會翻轉）
    this.patchPosition.set(x, this.canvas.height - y - h);
    if (this.cpu) {
      const img = this.ctx.getImageData(x, y, w, h);
      this.uploadPatch(gl, img.data, w, h);
      this.uploadStats.partial++;
      this.uploadStats.partialPixels += w * h;
      return;
    }
    if (this.patch.width !== w || this.patch.height !== h) {
      this.patch.width = w;
      this.patch.height = h;
    } else {
      this.patchCtx.clearRect(0, 0, w, h);
    }
    this.patchCtx.drawImage(this.canvas, x, y, w, h, 0, 0, w, h);
    this.uploadPatch(gl, this.patch, w, h);
    this.uploadStats.partial++;
    this.uploadStats.partialPixels += w * h;
  }

  /**
   * 局部上傳：直接呼叫 texSubImage2D。
   * 不用 three.js 的 copyTextureToTexture：它每次會用 getParameter 讀回 5 個像素設定再還原，
   * 在 Chrome 裡 getParameter 要等 GPU 行程把排隊的工作做完（同步），介面每幀有變化時會造成卡頓。
   */
  private uploadPatch(
    renderer: THREE.WebGLRenderer,
    source: HTMLCanvasElement | OffscreenCanvas | Uint8ClampedArray,
    w: number,
    h: number,
  ): void {
    const webglTexture = (renderer.properties.get(this.texture) as { __webglTexture?: WebGLTexture }).__webglTexture;
    const gl = renderer.getContext();
    if (!webglTexture) {
      // 還沒有 GPU 貼圖（不應該發生）：下次整張上傳
      this.texture.needsUpdate = true;
      return;
    }
    renderer.state.bindTexture(gl.TEXTURE_2D, webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, this.texture.flipY);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, this.texture.premultiplyAlpha);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, this.texture.unpackAlignment);
    // 和 three.js 整張上傳的設定一樣（顏色才會一致）
    const t = this.texture.colorSpace;
    const sameGamut =
      t === THREE.NoColorSpace ||
      THREE.ColorManagement.getPrimaries(THREE.ColorManagement.workingColorSpace) ===
        THREE.ColorManagement.getPrimaries(t);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, sameGamut ? gl.NONE : gl.BROWSER_DEFAULT_WEBGL);
    const { x, y } = this.patchPosition;
    if (source instanceof Uint8ClampedArray) {
      const data = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    }
  }

  /** 釋放 */
  dispose(): void {
    this.texture.dispose();
    this.ui = null;
    this.painter = null;
  }
}
