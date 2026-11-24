import * as THREE from 'three';
import type { UIRenderer } from './CanvasRenderer';
import type { UI2D } from './UI2D';
import { UIPainter, type Context2D } from './UIPainter';
import type { Rect } from './elements';

const makeCanvas = (): HTMLCanvasElement | OffscreenCanvas =>
  typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');

/**
 * 介面畫布放在哪裡：
 * - gpu：瀏覽器預設（Chrome 的 2D 畫布在 GPU 上，複製到貼圖是 GPU 內部複製，很快）
 * - cpu：畫布放在記憶體（willReadFrequently），局部更新直接讀像素資料上傳。
 *   Safari 的 2D 畫布在 GPU 上，複製到貼圖時要先從 GPU 讀回來並等待，用 cpu 快很多
 * - auto（預設）：WebKit（Safari、iOS 上所有瀏覽器）用 cpu，其他用 gpu
 *
 * 實測（全螢幕、2 倍像素比，遊戲中每次介面重畫）：Safari gpu 約 8 ms、cpu 約 4 ms；Chrome gpu 約 0.9 ms、讀像素資料約 6.6 ms。
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
  /** 整張上傳的次數 */
  full: number;
  /** 局部更新的次數（只重畫、只上傳變動的範圍） */
  partial: number;
  /** 局部更新的總像素數 */
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

/** 局部更新要用的繪製器功能（three.js 的 WebGPURenderer 有） */
export interface UITextureCopier {
  /**
   * 把 src 的一塊（srcRegion，貼圖像素）複製到 dst 的 dstPosition
   * @param src 來源貼圖
   * @param dst 目的貼圖
   * @param srcRegion 來源的範圍（貼圖像素）
   * @param dstPosition 放到目的的哪裡（貼圖像素）
   */
  copyTextureToTexture(src: THREE.Texture, dst: THREE.Texture, srcRegion: THREE.Box2, dstPosition: THREE.Vector2): void;
}

/** 變動的範圍超過畫面的這個比例時，直接整張上傳 */
const PARTIAL_MAX_AREA = 0.35;
/** 小畫布的尺寸以這個大小為單位往上取（尺寸常變時不用一直重新配置 GPU 貼圖） */
const PATCH_STEP = 128;

/**
 * 把介面畫在畫布上，並維護對應的 GPU 貼圖。
 * 介面有變動時才重畫；只有一小塊變動時只重畫那一塊，並且只上傳那一塊：
 * 先複製到一張小畫布、上傳小貼圖，再在 GPU 上複製到介面貼圖的對應位置。
 * 整張上傳很貴（全螢幕介面有好幾千萬像素；Safari 還要先把 2D 畫布從 GPU 讀回來），每次介面動畫都整張上傳會拖慢整個畫面。
 * 2D 疊加層（UIPlugin）與 3D 面板（UI3D）共用。
 */
export class UITextureRenderer implements UIRenderer {
  /** 繪製介面的畫布 */
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** 介面的貼圖（three.js） */
  readonly texture: THREE.CanvasTexture;
  /** 預設的畫布模式（建立之前設定才有效） */
  static canvasMode: UICanvasMode = 'auto';
  /**
   * 局部更新怎麼把變動的那一塊送到 GPU：
   * - canvas：複製到小畫布、上傳小畫布（畫布在 GPU 上時快）
   * - pixels：讀出那一塊的像素資料（getImageData）上傳（畫布在記憶體時快）
   * - auto（預設）：cpu 畫布用 pixels，gpu 畫布用 canvas
   */
  static uploadMode: 'auto' | 'canvas' | 'pixels' = 'auto';
  /** 這個實例的局部更新方式 */
  uploadMode: 'canvas' | 'pixels';
  /** 統計：上傳次數、重畫時間（效能分析用） */
  readonly uploadStats: UIRenderStats;
  /** cpu 模式：畫布在記憶體 */
  private readonly cpu: boolean;
  private readonly ctx: Context2D;
  private ui: UI2D | null = null;
  private painter: UIPainter | null = null;
  /** 畫布上已經有完整的介面（之後才能只重畫變動的範圍） */
  private painted = false;
  /** 局部更新用的小畫布與它的貼圖 */
  private patch: { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Context2D; texture: THREE.CanvasTexture } | null =
    null;
  /** 局部更新用的像素資料貼圖（uploadMode 為 pixels 時） */
  private patchData: { texture: THREE.DataTexture; data: Uint8Array; width: number; height: number } | null = null;
  private readonly region = new THREE.Box2();
  private readonly position = new THREE.Vector2();

  /**
   * @param onRendered 畫布更新後呼叫（例如遊戲暫停時補畫一次 3D 畫面）
   * @param copier 取得可以複製貼圖的繪製器（局部更新用）；沒有時（例如還沒初始化、測試環境）整張上傳
   */
  constructor(
    private readonly onRendered?: (ui: UI2D) => void,
    private readonly copier?: () => UITextureCopier | null,
  ) {
    const mode = UITextureRenderer.canvasMode;
    this.cpu = mode === 'auto' ? isWebKit() : mode === 'cpu';
    const upload = UITextureRenderer.uploadMode;
    this.uploadMode = upload === 'auto' ? (this.cpu ? 'pixels' : 'canvas') : upload;
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
  }

  /**
   * 連接到介面
   * @param ui 介面
   */
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
      this.painted = false;
      regions = null;
    }
    if (!ui.root) {
      this.onRendered?.(ui);
      return;
    }
    if (regions && regions.length === 0) return; // 沒有變化

    const copier = regions && this.painted ? (this.copier?.() ?? null) : null;
    if (regions && this.painted) {
      // 只重畫變動的範圍
      for (const r of regions) this.painter.paint(this.ctx, ui.root, width, height, pr, ui.paintState, r);
      // 只上傳變動的範圍（範圍太大、沒有繪製器時整張上傳）
      const area = regions.reduce((sum, r) => sum + r.width * r.height, 0);
      if (copier && area <= width * height * PARTIAL_MAX_AREA) {
        for (const r of regions) this.uploadRegion(copier, r, pr, w, h);
        this.uploadStats.partial++;
        this.onRendered?.(ui);
        return;
      }
      this.uploadStats.full++;
    } else {
      this.painter.paint(this.ctx, ui.root, width, height, pr, ui.paintState);
      this.painted = true;
      this.uploadStats.full++;
    }
    this.texture.needsUpdate = true;
    this.onRendered?.(ui);
  }

  /** 把畫布上的一塊（CSS 像素）上傳到介面貼圖的同一個位置 */
  private uploadRegion(copier: UITextureCopier, r: Rect, pr: number, w: number, h: number): void {
    const x0 = Math.max(0, Math.floor(r.x * pr));
    const y0 = Math.max(0, Math.floor(r.y * pr));
    const x1 = Math.min(w, Math.ceil((r.x + r.width) * pr));
    const y1 = Math.min(h, Math.ceil((r.y + r.height) * pr));
    const rw = x1 - x0;
    const rh = y1 - y0;
    if (rw <= 0 || rh <= 0) return;
    const pw = Math.ceil(rw / PATCH_STEP) * PATCH_STEP;
    const ph = Math.ceil(rh / PATCH_STEP) * PATCH_STEP;
    if (this.uploadMode === 'pixels') {
      this.uploadPixels(copier, x0, y0, rw, rh, pw, ph, h);
      return;
    }
    let patch = this.patch;
    if (!patch || patch.canvas.width !== pw || patch.canvas.height !== ph) {
      patch?.texture.dispose();
      const canvas = makeCanvas();
      canvas.width = pw;
      canvas.height = ph;
      const texture = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
      texture.colorSpace = this.texture.colorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      patch = this.patch = { canvas, ctx: canvas.getContext('2d') as Context2D, texture };
    }
    patch.ctx.clearRect(0, 0, rw, rh);
    patch.ctx.drawImage(this.canvas, x0, y0, rw, rh, 0, 0, rw, rh);
    patch.texture.needsUpdate = true;
    // 上傳時兩張貼圖都上下翻轉（flipY）：貼圖的第 0 列是畫布的最下面一列
    this.region.min.set(0, ph - rh);
    this.region.max.set(rw, ph);
    this.position.set(x0, h - y1);
    copier.copyTextureToTexture(patch.texture, this.texture, this.region, this.position);
    this.uploadStats.partialPixels += rw * rh;
  }

  /** 局部更新（pixels）：讀出那一塊的像素，上下顛倒放進資料貼圖（資料貼圖不翻轉），再在 GPU 上複製 */
  private uploadPixels(
    copier: UITextureCopier,
    x0: number,
    y0: number,
    rw: number,
    rh: number,
    pw: number,
    ph: number,
    h: number,
  ): void {
    let p = this.patchData;
    if (!p || p.width !== pw || p.height !== ph) {
      p?.texture.dispose();
      const data = new Uint8Array(pw * ph * 4);
      const texture = new THREE.DataTexture(data, pw, ph, THREE.RGBAFormat, THREE.UnsignedByteType);
      texture.colorSpace = this.texture.colorSpace;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      p = this.patchData = { texture, data, width: pw, height: ph };
    }
    const src = this.ctx.getImageData(x0, y0, rw, rh).data;
    const row = rw * 4;
    // 資料貼圖的第 0 列 = 這一塊最下面一列（和介面貼圖上傳時的上下翻轉一致）
    for (let i = 0; i < rh; i++) p.data.set(src.subarray((rh - 1 - i) * row, (rh - i) * row), i * pw * 4);
    p.texture.needsUpdate = true;
    this.region.min.set(0, 0);
    this.region.max.set(rw, rh);
    this.position.set(x0, h - (y0 + rh));
    copier.copyTextureToTexture(p.texture, this.texture, this.region, this.position);
    this.uploadStats.partialPixels += rw * rh;
  }

  /** 釋放 */
  dispose(): void {
    this.patch?.texture.dispose();
    this.patch = null;
    this.patchData?.texture.dispose();
    this.patchData = null;
    this.texture.dispose();
    this.ui = null;
    this.painter = null;
  }
}
