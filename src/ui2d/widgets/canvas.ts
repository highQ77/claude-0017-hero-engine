/** 進階介面元件：畫布（用 Canvas 2D 的寫法自己畫，底層以 WebGL 繪製） */
import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import { UIElement, type Attrs, type PointerCapture, type UICanvasHost } from '../elements';
import { num, roundRectPath, uiFont } from '../draw';
import WebGL2D, {
  type WebGL2DHiDPIOptions,
  type WebGL2DOptions,
  type WebGL2DPath2D,
  type WebGL2DRenderingContext,
  type ShaderFilter,
} from '../canvas2d/webgl2d.js';

export type { WebGL2DHiDPIOptions, WebGL2DOptions, WebGL2DRenderingContext, ShaderFilter };

/** 會改變畫面內容的繪圖方法：呼叫後自動要求介面重畫 */
const DRAW_METHODS = [
  'clearRect',
  'fillRect',
  'strokeRect',
  'fill',
  'stroke',
  'fillText',
  'strokeText',
  'drawImage',
  'putImageData',
  'drawFocusIfNeeded',
  'applyFilter',
  'reset',
] as const;

/** 畫布能用的最大像素比（太大會超過 WebGL 的貼圖上限、耗記憶體） */
const MAX_PIXEL_RATIO = 4;

/**
 * 畫布：用和 Canvas 2D 一模一樣的 API 自由繪圖（圖表、簽名板、小遊戲、自訂特效），
 * 底層是 WebGL（WebGL2D），繪圖結果會成為介面的一部分，跟著排版、透明度、裁切一起顯示。
 *
 * - width／height 是繪圖座標的大小（CSS 像素）；實際解析度會乘上螢幕的像素比，畫面清晰
 * - background 是畫布後面的底色（預設 #333333FF）；ctx.clearRect 清掉的地方會露出底色
 * - 用 ui.require<UICanvas>('id').getContext() 取得繪圖 context（取代 canvas.getContext('2d')）
 * - 引擎內（UIPlugin）直接畫在顯示層的 WebGL 上（共用模式）：畫圖不用重畫介面、不用複製畫面；
 *   網頁版介面、UI 編輯器沒有顯示層，改用自己的 WebGL，畫好再複製到介面
 * - uicanvas.texture 可以直接貼到 3D 物件上（共用模式不用上傳）
 * - 尺寸改變時畫布內容會清空，並觸發 resize 事件（onResize），在那裡重畫
 * - 滑鼠／觸控：按下、拖曳、放開觸發 pointerdown、pointermove、pointerup 事件
 *   （onPointerdown 等），event.value 是繪圖座標 { x, y }（已換算縮放，可以直接拿來畫）
 *
 * @example <UICanvas id="chart" width="320" height="200" background="#333333FF"/>
 */
export class UICanvas extends UIElement {
  /** WebGL2D 的 Path2D（和原生 Path2D 相同；也可以傳 SVG 路徑字串） */
  static readonly Path2D: typeof WebGL2DPath2D = WebGL2D.Path2D;
  /** WebGL2D 的版本 */
  static readonly version: string = WebGL2D.version;

  /**
   * 讓一般的 &lt;canvas&gt; 也能用 WebGL2D：canvas.getContext('webgl-2d') 會回傳 WebGL2D context
   * （介面以外的畫布用；UICanvas 不需要呼叫）
   */
  static install(): void {
    WebGL2D.install();
  }

  /** 對任意 &lt;canvas&gt; 取得 WebGL2D context（介面以外的畫布用；UICanvas 請用 getContext()）；同一個 canvas 回傳同一個物件 */
  static contextOf(canvas: HTMLCanvasElement, options?: WebGL2DOptions): WebGL2DRenderingContext {
    return WebGL2D.getContext(canvas, options);
  }

  /**
   * 對任意 &lt;canvas&gt; 建立高解析度的 WebGL2D context：backing store = CSS 尺寸 × devicePixelRatio，
   * 繪圖座標仍是 CSS 像素（離屏圖層、快取用）
   */
  static contextOfHiDPI(canvas: HTMLCanvasElement, options?: WebGL2DHiDPIOptions): WebGL2DRenderingContext {
    return WebGL2D.getContextHiDPI(canvas, options);
  }

  /** WebGL2D context 的類別：new UICanvas.RenderingContext(canvas, options) 不經過快取，每次都建立新的 WebGL context */
  static readonly RenderingContext: new (
    canvas: HTMLCanvasElement,
    options?: WebGL2DOptions,
  ) => WebGL2DRenderingContext = WebGL2D.WebGL2DRenderingContext;

  private el: HTMLCanvasElement | null = null;
  private gl2d: WebGL2DRenderingContext | null = null;
  /** 共用模式：顯示層的宿主、畫面大小（實體像素）、取消登記 */
  private host: UICanvasHost | null = null;
  private target: { width: number; height: number } | null = null;
  private removeLayer: (() => void) | null = null;
  /** 共用模式：讀回來的畫面（canvas、toDataURL 用） */
  private snapshotEl: HTMLCanvasElement | null = null;
  private threeTexture: Texture | null = null;
  private logicalW = 0;
  private logicalH = 0;
  private ratio = 1;
  private dirtyQueued = false;
  /** 曾經畫過東西（編輯器裡沒畫過的畫布會顯示名稱提示） */
  private drawn = false;

  override defaults(): Attrs {
    return { width: '300', height: '150', background: '#333333FF' };
  }

  /** 繪圖座標的寬（CSS 像素） */
  get width(): number {
    return this.logicalW || num(this.attrs.width, 300);
  }

  /** 繪圖座標的高（CSS 像素） */
  get height(): number {
    return this.logicalH || num(this.attrs.height, 150);
  }

  /** 每個繪圖座標單位對應幾個實體像素（pixelRatio 屬性，預設為螢幕的像素比） */
  get pixelRatio(): number {
    const attr = this.attrs.pixelRatio;
    const screen = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const pr = attr === undefined || attr === 'auto' ? screen : num(attr, screen);
    return Math.max(0.25, Math.min(MAX_PIXEL_RATIO, pr));
  }

  /**
   * 底層的 &lt;canvas&gt;（不在網頁上顯示，畫好的內容由介面繪製；可以當成 drawImage 的來源）。
   * 共用模式沒有自己的 canvas：每次取用都從 GPU 讀回目前的畫面（比較慢，不要每幀用；3D 請用 texture）
   */
  get canvas(): HTMLCanvasElement {
    if (this.target && this.gl2d) return this.snapshot();
    if (!this.el) {
      if (typeof document === 'undefined') throw new Error('UICanvas：這個環境沒有 document，無法建立畫布');
      this.el = document.createElement('canvas');
      this.resizeBacking();
    }
    return this.el;
  }

  /** 是否已經建立繪圖 context */
  get hasContext(): boolean {
    return this.gl2d !== null;
  }

  /** 是否直接畫在顯示層的 WebGL 上（共用模式；引擎內顯示時） */
  get shared(): boolean {
    return this.target !== null;
  }

  /**
   * 給 3D 物件用的貼圖（three.js；和一般圖片貼圖一樣，有透明的地方材質設 transparent: true）。
   * 共用模式直接用畫布的 GPU 貼圖，不用上傳，同一幀就看得到；其他情況用畫布建立 CanvasTexture，畫圖後自動更新
   */
  get texture(): Texture {
    if (this.threeTexture) return this.threeTexture;
    const ctx = this.getContext();
    if (this.host && ctx.exportTexture) {
      this.threeTexture = this.host.wrapTexture(ctx.exportTexture, 'srgb');
    } else {
      const t = new CanvasTexture(this.canvas);
      t.colorSpace = SRGBColorSpace;
      this.threeTexture = t;
    }
    return this.threeTexture;
  }

  /**
   * 取得繪圖 context（和 CanvasRenderingContext2D 用法相同）。
   * 第一次呼叫時建立 WebGL context，之後回傳同一個物件；options 只在第一次有效。
   * 呼叫繪圖方法後介面會自動重畫。
   */
  getContext(options: Omit<WebGL2DOptions, 'pixelRatio' | 'external'> = {}): WebGL2DRenderingContext {
    if (this.gl2d) return this.gl2d;
    const host = this.ctx.canvasHost?.() ?? null;
    const ctx = host
      ? this.createShared(host, options)
      : WebGL2D.getContext(this.canvas, { ...options, pixelRatio: this.ratio });
    for (const name of DRAW_METHODS) {
      const original = ctx[name] as (...args: unknown[]) => unknown;
      (ctx as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        const result = original.apply(ctx, args);
        this.markDirty();
        return result;
      };
    }
    this.gl2d = ctx;
    return ctx;
  }

  /** 改變繪圖座標的大小（同 set('width')、set('height')）；內容會清空並觸發 resize 事件 */
  resize(width: number, height: number): this {
    this.set('width', width);
    return this.set('height', height);
  }

  /** 要求介面重畫畫布（用繪圖方法畫圖時會自動呼叫；直接操作 ctx.gl 時要自己呼叫） */
  update(): void {
    this.markDirty();
  }

  /** 介面座標 → 繪圖座標（畫布顯示的大小和繪圖座標不同時也正確） */
  toCanvasPoint(x: number, y: number): { x: number; y: number } {
    const r = this.absoluteRect;
    return {
      x: r.width > 0 ? ((x - r.x) / r.width) * this.width : 0,
      y: r.height > 0 ? ((y - r.y) / r.height) * this.height : 0,
    };
  }

  /** 畫布接收滑鼠：可以畫圖、拖曳（pointerEvents="none" 時穿透） */
  override get interactive(): boolean {
    return this.attrs.pointerEvents !== 'none';
  }

  /** 按下時接管指標：之後的移動、放開都送給這個畫布（拖出範圍也一樣） */
  override pointerDown(x: number, y: number): PointerCapture | null {
    if (this.attrs.pointerEvents === 'none') return null;
    this.emit('pointerdown', { value: this.toCanvasPoint(x, y) });
    return {
      move: (mx, my) => this.emit('pointermove', { value: this.toCanvasPoint(mx, my) }),
      up: (ux, uy) => this.emit('pointerup', { value: this.toCanvasPoint(ux, uy) }),
      cancel: () => this.emit('pointerup', { value: null }),
    };
  }

  /** 把畫布內容輸出成圖片網址（例如截圖、存檔） */
  toDataURL(type?: string, quality?: number): string {
    // 共用模式：canvas 是讀回來的畫面
    return this.canvas.toDataURL(type, quality);
  }

  override applyLayout(): void {
    super.applyLayout();
    // 寬高寫數字：繪圖座標就是這個大小；百分比、auto 等依排版結果決定（見 paintContent）
    const w = parseFloat(this.attrs.width ?? '');
    const h = parseFloat(this.attrs.height ?? '');
    const fixedW = /^\s*[\d.]+\s*$/.test(this.attrs.width ?? '') ? w : 0;
    const fixedH = /^\s*[\d.]+\s*$/.test(this.attrs.height ?? '') ? h : 0;
    this.setLogicalSize(fixedW || this.logicalW, fixedH || this.logicalH);
  }

  override paintContent(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    // 寬高不是數字（百分比、auto、flex）：繪圖座標跟著排版大小
    const autoW = !/^\s*[\d.]+\s*$/.test(this.attrs.width ?? '');
    const autoH = !/^\s*[\d.]+\s*$/.test(this.attrs.height ?? '');
    if ((autoW && Math.round(w) !== this.logicalW) || (autoH && Math.round(h) !== this.logicalH)) {
      const nw = autoW ? Math.round(w) : this.logicalW;
      const nh = autoH ? Math.round(h) : this.logicalH;
      // 畫面繪製中不要改尺寸、觸發事件：等這一幀畫完
      queueMicrotask(() => this.setLogicalSize(nw, nh));
    }

    const radius = num(this.attrs.radius, 0);
    if (radius > 0) {
      roundRectPath(ctx, x, y, w, h, radius);
      ctx.clip();
    }
    // 共用模式：畫布由顯示層疊上去，介面這裡只畫背景與邊框
    if (this.target) return;
    if (this.gl2d && this.el && this.el.width > 0 && this.el.height > 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.el, x, y, w, h);
    } else if (this.ctx.editorHints && !this.drawn) {
      // 編輯器：還沒有程式畫東西，顯示名稱與大小
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = uiFont(12);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = `UICanvas${this.id ? ` #${this.id}` : ''}  ${this.width}×${this.height}`;
      ctx.fillText(label, x + w / 2, y + h / 2, Math.max(0, w - 8));
    }
  }

  override destroy(): void {
    this.removeLayer?.();
    this.removeLayer = null;
    this.threeTexture?.dispose();
    this.threeTexture = null;
    // 共用模式只釋放自己的 GPU 資源；一般模式連 WebGL context 一起釋放
    this.gl2d?.dispose();
    this.gl2d = null;
    this.el = null;
    this.target = null;
    super.destroy();
  }

  // ───────── 內部 ─────────

  private setLogicalSize(w: number, h: number): void {
    const width = Math.max(1, Math.round(w || num(this.attrs.width, 300)));
    const height = Math.max(1, Math.round(h || num(this.attrs.height, 150)));
    const pr = this.pixelRatio;
    if (width === this.logicalW && height === this.logicalH && pr === this.ratio) return;
    const first = this.logicalW === 0;
    this.logicalW = width;
    this.logicalH = height;
    this.ratio = pr;
    if (!this.el && !this.target) return;
    this.resizeBacking();
    if (!first) this.emit('resize', { value: `${width}x${height}` });
  }

  private resizeBacking(): void {
    const el = (this.target ?? this.el)!;
    if (!this.logicalW) {
      this.logicalW = Math.max(1, Math.round(num(this.attrs.width, 300)));
      this.logicalH = Math.max(1, Math.round(num(this.attrs.height, 150)));
      this.ratio = this.pixelRatio;
    }
    el.width = Math.max(1, Math.round(this.logicalW * this.ratio));
    el.height = Math.max(1, Math.round(this.logicalH * this.ratio));
    if (this.gl2d) {
      // 尺寸改變後 WebGL 的畫面已經清空：重設狀態，讓座標系統跟上新的大小
      this.gl2d.pixelRatio = this.ratio;
      this.gl2d.reset();
    }
  }

  /**
   * 畫了新東西：要求介面重畫，但每幀最多一次（下一幀開頭）。
   * 滑鼠事件一秒可能上百次（比畫面更新還頻繁），每次都重畫、複製到介面貼圖會讓 GPU 忙不過來；
   * 合併到下一幀，不管這一幀畫了多少筆，都只更新一次。
   * 實測比「畫完馬上（microtask）通知」省：那樣介面貼圖會在 3D 畫面畫完後才上傳，GPU 要等前面的工作做完
   */
  private markDirty(): void {
    this.drawn = true;
    // 共用模式：顯示層每幀直接讀畫布的 GPU 貼圖，介面不用重畫
    if (this.target) return;
    if (this.dirtyQueued) return;
    this.dirtyQueued = true;
    const flush = () => {
      this.dirtyQueued = false;
      if (this.isDestroyed) return;
      this.invalidate();
      if (this.threeTexture) this.threeTexture.needsUpdate = true;
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else queueMicrotask(flush);
  }

  /** 共用模式：借用顯示層的 WebGL，畫進自己的 framebuffer，登記成顯示層的一塊 */
  private createShared(
    host: UICanvasHost,
    options: Omit<WebGL2DOptions, 'pixelRatio' | 'external'>,
  ): WebGL2DRenderingContext {
    this.target = { width: 1, height: 1 };
    this.resizeBacking();
    const ctx = new WebGL2D.WebGL2DRenderingContext(this.target as unknown as HTMLCanvasElement, {
      ...options,
      pixelRatio: this.ratio,
      external: { gl: host.gl, onEnd: () => host.resetState() },
    });
    this.host = host;
    this.removeLayer = host.add({
      element: this,
      texture: () => ctx.outputTexture,
      // 有人用 texture（3D）時，畫面有變就更新 3D 用的貼圖
      beforeDraw: () => {
        if (this.threeTexture) ctx.syncExport();
      },
    });
    return ctx;
  }

  /** 共用模式：從 GPU 讀回目前的畫面 */
  private snapshot(): HTMLCanvasElement {
    const t = this.target!;
    const el = (this.snapshotEl ??= document.createElement('canvas'));
    el.width = t.width;
    el.height = t.height;
    el.getContext('2d')!.putImageData(this.gl2d!.getImageData(0, 0, t.width, t.height), 0, 0);
    return el;
  }
}
