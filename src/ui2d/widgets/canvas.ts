/** 進階介面元件：畫布（用 Canvas 2D 的寫法自己畫，底層以 WebGL 繪製） */
import {
  CanvasTexture,
  ExternalTexture,
  LinearSRGBColorSpace,
  NoColorSpace,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { UIElement, type Attrs, type PointerCapture } from '../elements';
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
 * - 引擎內（UIPlugin）分層顯示：畫布的內容用自己的貼圖疊在介面上，畫圖時介面不用重畫、不用複製
 *   （有東西蓋在畫布上面時自動改回複製進介面）；網頁版介面、UI 編輯器、3D 面板畫好再複製到介面
 * - uicanvas.texture 可以直接貼到 3D 物件上（和分層顯示用的是同一張貼圖，畫圖後只上傳一次）
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

  /**
   * 對任意 &lt;canvas&gt; 取得 WebGL2D context（介面以外的畫布用；UICanvas 請用 getContext()）；同一個 canvas 回傳同一個物件
   * @param canvas 畫布
   * @param options 是否透明、反鋸齒、像素比、WebGL 2、共用別人的 WebGL（external）等
   */
  static contextOf(canvas: HTMLCanvasElement, options?: WebGL2DOptions): WebGL2DRenderingContext {
    return WebGL2D.getContext(canvas, options);
  }

  /**
   * 對任意 &lt;canvas&gt; 建立高解析度的 WebGL2D context：backing store = CSS 尺寸 × devicePixelRatio，
   * 繪圖座標仍是 CSS 像素（離屏圖層、快取用）
   * @param canvas 畫布
   * @param options 繪圖座標的寬高、像素比、是否設定 CSS 大小、反鋸齒等
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
  private threeTexture: Texture | null = null;
  /**
   * 共用模式（3D 畫面是 WebGL 2 時）：借用它的 WebGL 畫進自己的 framebuffer，這裡記實體像素的大小。
   * 沒有自己的 &lt;canvas&gt;
   */
  private target: { width: number; height: number } | null = null;
  /** 共用模式：直接包裝 WebGL2D 的輸出貼圖（分層顯示用，不用另外複製） */
  private outputTex: ExternalTexture | null = null;
  /** 共用模式：讀回來的畫面（canvas、toDataURL、沒有分層時複製進介面用） */
  private snapshotEl: HTMLCanvasElement | null = null;
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
   * 共用模式（3D 畫面是 WebGL 2）沒有自己的 canvas：每次取用都從 GPU 讀回目前的畫面（比較慢，不要每幀用；3D 請用 texture）
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

  /**
   * 是否分層顯示：引擎內的介面把畫布內容用它的貼圖直接疊上去（畫圖時介面不用重畫）。
   * 有東西蓋在畫布上面、在捲動區裡、有圓角時是 false（複製進介面）
   */
  get layered(): boolean {
    return this.ctx.canvasLayers?.()?.isLayered(this) ?? false;
  }

  /** 是否借用 3D 畫面的 WebGL 直接畫（共用模式；3D 畫面是 WebGL 2 時） */
  get shared(): boolean {
    return this.target !== null;
  }

  /**
   * 分層顯示用的貼圖（顯示層用；遊戲一般用 texture）。
   * 共用模式直接用 WebGL2D 的輸出貼圖，不另外轉成給 3D 用的格式（省下每幀一次複製與 mipmap）：
   * encoded 為 true，表示顏色是預乘 alpha 的 sRGB 值，要在著色器裡還原
   */
  get layerTexture(): {
    /** 畫布的貼圖 */
    texture: Texture;
    /** true：顏色是預乘 alpha 的 sRGB 值，要在著色器裡還原 */
    encoded: boolean;
  } {
    const ctx = this.getContext();
    if (this.target && ctx.outputTexture) {
      if (!this.outputTex) {
        const t = new ExternalTexture(ctx.outputTexture);
        t.colorSpace = NoColorSpace;
        (t as unknown as { image: unknown }).image = { width: this.target.width, height: this.target.height };
        this.outputTex = t;
      }
      return { texture: this.outputTex, encoded: true };
    }
    return { texture: this.texture, encoded: false };
  }

  /**
   * 給 3D 物件用的貼圖（three.js；和一般圖片貼圖一樣，有透明的地方材質設 transparent: true）。
   * 一般是用畫布建立的 CanvasTexture，畫圖後自動上傳；共用模式直接用畫布的 GPU 貼圖，不用上傳。
   * 分層顯示也是用這一張
   */
  get texture(): Texture {
    if (this.threeTexture) return this.threeTexture;
    const ctx = this.getContext();
    if (this.target && ctx.exportTexture) {
      // 共用模式：WebGL2D 的輸出貼圖（SRGB8_ALPHA8，GPU 讀取時自動轉成線性，所以這裡標成線性；第 0 列是底部）
      ctx.syncExport();
      const t = new ExternalTexture(ctx.exportTexture);
      t.colorSpace = LinearSRGBColorSpace;
      (t as unknown as { image: unknown }).image = { width: this.target.width, height: this.target.height };
      this.threeTexture = t;
      return t;
    }
    const t = new CanvasTexture(this.canvas);
    t.colorSpace = SRGBColorSpace;
    this.threeTexture = t;
    return t;
  }

  /**
   * 取得繪圖 context（和 CanvasRenderingContext2D 用法相同）。
   * 第一次呼叫時建立 WebGL context，之後回傳同一個物件；options 只在第一次有效。
   * 呼叫繪圖方法後介面會自動重畫。
   * @param options 第一次建立時的設定：WebGL 2、反鋸齒、透明…
   */
  getContext(options: Omit<WebGL2DOptions, 'pixelRatio' | 'external'> = {}): WebGL2DRenderingContext {
    if (this.gl2d) return this.gl2d;
    const shared = this.ctx.canvasLayers?.()?.sharedGL?.() ?? null;
    const ctx = shared
      ? this.createShared(shared, options)
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

  /**
   * 改變繪圖座標的大小（同 set('width')、set('height')）；內容會清空並觸發 resize 事件
   * @param width 繪圖座標的寬
   * @param height 繪圖座標的高
   */
  resize(width: number, height: number): this {
    this.set('width', width);
    return this.set('height', height);
  }

  /** 要求介面重畫畫布（用繪圖方法畫圖時會自動呼叫；直接操作 ctx.gl 時要自己呼叫） */
  update(): void {
    this.markDirty();
  }

  /**
   * 介面座標 → 繪圖座標（畫布顯示的大小和繪圖座標不同時也正確）
   * @param x X（介面座標）
   * @param y Y（介面座標）
   */
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

  /**
   * 按下時接管指標：之後的移動、放開都送給這個畫布（拖出範圍也一樣）
   * @param x X（介面座標）
   * @param y Y（介面座標）
   */
  override pointerDown(x: number, y: number): PointerCapture | null {
    if (this.attrs.pointerEvents === 'none') return null;
    this.emit('pointerdown', { value: this.toCanvasPoint(x, y) });
    return {
      move: (mx, my) => this.emit('pointermove', { value: this.toCanvasPoint(mx, my) }),
      up: (ux, uy) => this.emit('pointerup', { value: this.toCanvasPoint(ux, uy) }),
      cancel: () => this.emit('pointerup', { value: null }),
    };
  }

  /**
   * 把畫布內容輸出成圖片網址（例如截圖、存檔）
   * @param type 圖片格式（預設 'image/png'）
   * @param quality 品質 0~1（jpeg、webp）
   */
  toDataURL(type?: string, quality?: number): string {
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
    // 分層顯示：畫布內容由顯示層疊上去，介面這裡只畫背景與邊框
    if (this.layered) return;
    // 共用模式沒有分層（有東西蓋在上面）：讀回畫面再複製進介面（比較慢，只在這種時候）
    const source = this.target && this.gl2d ? this.snapshot() : this.el;
    if (this.gl2d && source && source.width > 0 && source.height > 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(source, x, y, w, h);
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
    this.threeTexture?.dispose();
    this.threeTexture = null;
    this.outputTex?.dispose();
    this.outputTex = null;
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
    if (this.dirtyQueued) return;
    this.dirtyQueued = true;
    const flush = () => {
      this.dirtyQueued = false;
      if (this.isDestroyed) return;
      const layers = this.ctx.canvasLayers?.() ?? null;
      // 共用模式：解析多重取樣（輸出貼圖才是最新的，分層顯示直接用它）；
      // 有 3D 物件用 texture 時，才另外更新給 3D 用的貼圖（GPU 上複製一次、產生 mipmap）
      if (this.target && this.gl2d) {
        void this.gl2d.outputTexture;
        if (this.threeTexture) this.gl2d.syncExport();
      }
      if (layers?.isLayered(this)) {
        // 分層顯示：只更新畫布自己的貼圖，介面不用重畫（共用模式的貼圖本來就在 GPU 上）
        if (!this.target) this.texture.needsUpdate = true;
        layers.contentChanged(this);
        return;
      }
      this.invalidate();
      if (this.threeTexture && !this.target) this.threeTexture.needsUpdate = true;
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
    else queueMicrotask(flush);
  }

  /** 共用模式：借用 3D 畫面的 WebGL 2，畫進自己的 framebuffer */
  private createShared(
    shared: { gl: WebGL2RenderingContext; resetState(): void },
    options: Omit<WebGL2DOptions, 'pixelRatio' | 'external'>,
  ): WebGL2DRenderingContext {
    this.target = { width: 1, height: 1 };
    this.resizeBacking();
    return new WebGL2D.WebGL2DRenderingContext(this.target as unknown as HTMLCanvasElement, {
      ...options,
      pixelRatio: this.ratio,
      // 畫完讓 three.js 重新設定它的 GL 狀態
      external: { gl: shared.gl, onEnd: () => shared.resetState() },
    });
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
