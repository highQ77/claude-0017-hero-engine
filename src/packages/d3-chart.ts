/**
 * d3 圖表套件：在 2D 介面（ui2d）或 3D 面板（ui3d）裡用 d3.js 畫互動圖表。
 *
 * 註冊 <UID3Chart> 元件（繼承 UICanvas：和 Canvas 2D 一樣的繪圖 API）。d3 的比例尺、形狀、階層、力導向…
 * 照常使用，路徑產生器用 .context(ctx) 直接畫進畫布。元件負責互動與重畫：
 *
 * - 懸停：info.pointer 是滑鼠的繪圖座標（離開畫布時是 null），用來找最近的資料點、畫提示（drawTooltip）
 * - 縮放、平移：zoom="x"（只縮放橫軸，例如時間序列）、"y"、"xy"；滾輪縮放、拖曳平移。
 *   info.transform 是 d3 的 ZoomTransform：transform.rescaleX(x) 就是縮放後的比例尺
 * - 點擊：沒有拖動的按下→放開觸發 chartclick 事件（event.value 是繪圖座標）
 * - 縮放、平移時觸發 zoom 事件（event.value 是 ZoomTransform）
 * - 尺寸改變、懸停、縮放時自動重畫；資料改了呼叫 chart.redraw()
 *
 * 安裝：
 *   import d3Chart from '@engine/packages/d3-chart';
 *   await new PluginManager(engine, { api: { ui2d } }).install(d3Chart);
 *
 * XML：
 *   <UID3Chart id="sales" width="480" height="260" zoom="x" background="#1b1f27FF"/>
 *
 * 程式：
 *   import * as d3 from 'd3';
 *   import { drawTooltip, type UID3Chart } from '@engine/packages/d3-chart';
 *   const chart = ui.require<UID3Chart>('sales');
 *   chart.draw((ctx, { width, height, transform, pointer, d3Context }) => {
 *     const x = transform.rescaleX(d3.scaleLinear([0, 30], [40, width - 10]));
 *     const y = d3.scaleLinear([0, 100], [height - 24, 10]);
 *     ctx.beginPath();
 *     d3.line<Point>((d) => x(d.t), (d) => y(d.v)).context(d3Context)(data);
 *     ctx.stroke();
 *     if (pointer) drawTooltip(ctx, pointer.x, pointer.y, [`x = ${x.invert(pointer.x).toFixed(1)}`], { bounds: { width, height } });
 *   });
 *
 * 只透過 ctx.api 使用引擎的類別（UICanvas），所以可以獨立發布；d3 只用到 d3-zoom 的 ZoomTransform。
 */
import { zoomIdentity, type ZoomTransform } from 'd3-zoom';
import type { PluginContext } from '../plugins/PluginManager';
import { define as pluginApi } from '../plugins';
import type { Attrs, UICanvas, UIContext, WebGL2DRenderingContext } from '../ui2d';

/** 縮放方向：none（不縮放）、x（只縮放橫軸）、y（只縮放縱軸）、xy（兩個方向） */
export type ChartZoom = 'none' | 'x' | 'y' | 'xy';

/** 繪圖函式拿到的資訊 */
export interface ChartInfo {
  /** 繪圖座標的寬（CSS 像素） */
  width: number;
  /** 繪圖座標的高（CSS 像素） */
  height: number;
  /** 目前的縮放、平移（d3 的 ZoomTransform）：transform.rescaleX(比例尺)、transform.applyX(x)… */
  transform: ZoomTransform;
  /** 滑鼠的繪圖座標；不在畫布上時是 null */
  pointer: { x: number; y: number } | null;
  /** 是否正在拖曳（平移中） */
  dragging: boolean;
  /**
   * 給 d3 的 .context() 用：和 ctx 是同一個物件，型別標成 d3 要的 CanvasRenderingContext2D
   * （畫布的 context 多支援自訂濾鏡，型別和瀏覽器的不完全一樣；d3 只用到畫路徑的方法）
   * @example d3.line().context(d3Context)(data)
   */
  d3Context: CanvasRenderingContext2D;
}

/** 繪圖函式：每次重畫時呼叫（畫布已經清空） */
export type ChartDrawFn = (ctx: WebGL2DRenderingContext, info: ChartInfo) => void;

/** <UID3Chart> 元件（繼承 UICanvas） */
export interface UID3Chart extends UICanvas {
  /** 目前的縮放、平移 */
  readonly transform: ZoomTransform;
  /** 滑鼠的繪圖座標；不在畫布上時是 null */
  readonly pointer: { x: number; y: number } | null;
  /**
   * 設定繪圖函式並立刻畫一次（之後懸停、縮放、尺寸改變時自動重畫）
   * @param fn 繪圖函式：拿到 context 與 ChartInfo
   */
  draw(fn: ChartDrawFn): this;
  /** 重畫（資料改變時呼叫） */
  redraw(): void;
  /**
   * 設定縮放、平移（觸發 zoom 事件並重畫）
   * @param transform d3 的 ZoomTransform（例如 zoomIdentity.translate(10, 0).scale(2)）
   */
  setTransform(transform: ZoomTransform): void;
  /** 回到沒有縮放、平移的狀態 */
  resetZoom(): void;
}

/** 滾輪縮放的速度（每單位 deltaY） */
const WHEEL_SPEED = 0.002;
/** 按下後移動超過這個距離（繪圖座標）就算拖曳，不算點擊 */
const CLICK_SLOP = 4;

/**
 * 在畫布上畫提示框（圓角、半透明底、多行文字），自動避開畫布邊緣
 * @param ctx 畫布的 context
 * @param x 指向的 X（繪圖座標，通常是滑鼠或資料點）
 * @param y 指向的 Y（繪圖座標）
 * @param lines 每一行文字
 * @param options 字型、顏色、內距
 */
export function drawTooltip(
  ctx: WebGL2DRenderingContext,
  x: number,
  y: number,
  lines: readonly string[],
  options: {
    /** CSS 字型，預設 '12px system-ui, sans-serif' */
    font?: string;
    /** 文字顏色，預設 #e8ecf4 */
    color?: string;
    /** 底色，預設半透明深灰 */
    background?: string;
    /** 邊框顏色，預設 #5b6478 */
    border?: string;
    /** 內距（像素），預設 6 */
    padding?: number;
    /** 畫布的大小（繪圖座標）：提示框不會超出這個範圍；通常傳 ChartInfo 的 { width, height } */
    bounds?: { width: number; height: number };
  } = {},
): void {
  if (!lines.length) return;
  const font = options.font ?? '12px system-ui, sans-serif';
  const pad = options.padding ?? 6;
  const lineH = Number.parseFloat(font) * 1.35 || 16;
  ctx.save();
  ctx.font = font;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * lineH + pad * 2;
  const cw = options.bounds?.width ?? Number.POSITIVE_INFINITY;
  const ch = options.bounds?.height ?? Number.POSITIVE_INFINITY;
  // 預設在右上方；放不下就換邊
  let bx = x + 12;
  let by = y - h - 8;
  if (bx + w > cw - 2) bx = x - w - 12;
  if (by < 2) by = y + 12;
  bx = Math.max(2, Math.min(bx, cw - w - 2));
  by = Math.max(2, Math.min(by, ch - h - 2));
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 5);
  ctx.fillStyle = options.background ?? 'rgba(20, 24, 33, 0.92)';
  ctx.fill();
  ctx.strokeStyle = options.border ?? '#5b6478';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = options.color ?? '#e8ecf4';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad + i * lineH));
  ctx.restore();
}

/**
 * 建立 UID3Chart 類別（繼承傳入的 UICanvas；套件安裝時用 ctx.api.ui2d.UICanvas）
 * @param Base UICanvas 類別
 */
export function createD3ChartClass(Base: typeof UICanvas) {
  return class UID3ChartImpl extends Base implements UID3Chart {
    private drawFn: ChartDrawFn | null = null;
    private _transform: ZoomTransform = zoomIdentity;
    private _pointer: { x: number; y: number } | null = null;
    private dragging = false;
    private pending = false;

    constructor(ctx: UIContext, type: string, raw: Attrs = {}) {
      super(ctx, type, raw);
      this.on('resize', () => this.redraw());
      this.on('pointerhover', (e) => this.setPointer(e.value as { x: number; y: number }));
      this.on('pointerleave', () => this.setPointer(null));
    }

    get transform(): ZoomTransform {
      return this._transform;
    }

    get pointer(): { x: number; y: number } | null {
      return this._pointer;
    }

    /** zoom 屬性 */
    get zoomMode(): ChartZoom {
      const z = this.attrs.zoom;
      return z === 'x' || z === 'y' || z === 'xy' ? z : 'none';
    }

    /** 最小、最大縮放倍率（minZoom、maxZoom 屬性，預設 1、20） */
    get zoomExtent(): [number, number] {
      const min = Number.parseFloat(this.attrs.minZoom ?? '1');
      const max = Number.parseFloat(this.attrs.maxZoom ?? '20');
      return [Number.isFinite(min) ? min : 1, Number.isFinite(max) ? max : 20];
    }

    draw(fn: ChartDrawFn): this {
      this.drawFn = fn;
      this.redraw();
      return this;
    }

    redraw(): void {
      if (!this.drawFn || !this.hasRenderTarget()) return;
      const ctx = this.getContext();
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.save();
      try {
        this.drawFn(ctx, {
          width: this.width,
          height: this.height,
          transform: this._transform,
          pointer: this._pointer,
          dragging: this.dragging,
          d3Context: ctx as unknown as CanvasRenderingContext2D,
        });
      } finally {
        ctx.restore();
      }
    }

    setTransform(transform: ZoomTransform): void {
      this._transform = this.constrain(transform);
      this.emit('zoom', { value: this._transform });
      this.redraw();
    }

    resetZoom(): void {
      this.setTransform(zoomIdentity);
    }

    /** 沒有 document 的環境（測試、伺服器）不畫（getContext 會丟錯） */
    private hasRenderTarget(): boolean {
      return typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined';
    }

    private setPointer(p: { x: number; y: number } | null): void {
      this._pointer = p;
      // 同一幀內很多次移動只重畫一次
      if (this.pending) return;
      this.pending = true;
      queueMicrotask(() => {
        this.pending = false;
        this.redraw();
      });
    }

    /** 限制縮放倍率；只縮放一個方向時，另一個方向的平移固定為 0，平移不超出內容範圍 */
    private constrain(t: ZoomTransform): ZoomTransform {
      const [min, max] = this.zoomExtent;
      const k = Math.min(max, Math.max(min, t.k));
      const mode = this.zoomMode;
      const w = this.width;
      const h = this.height;
      // 內容（0..w × 0..h）縮放後不能拖到露出空白：x 在 [w - w·k, 0] 之間
      const clampX = (x: number) => Math.min(0, Math.max(w - w * k, x));
      const clampY = (y: number) => Math.min(0, Math.max(h - h * k, y));
      const x = mode === 'y' ? 0 : clampX(t.x);
      const y = mode === 'x' ? 0 : clampY(t.y);
      return zoomIdentity.translate(x, y).scale(k);
    }

    override pointerDown(x: number, y: number) {
      const cap = super.pointerDown(x, y);
      if (!cap) return null;
      const start = this.toCanvasPoint(x, y);
      const t0 = this._transform;
      let moved = false;
      return {
        move: (mx: number, my: number) => {
          cap.move(mx, my, null);
          const p = this.toCanvasPoint(mx, my);
          if (!moved && Math.hypot(p.x - start.x, p.y - start.y) > CLICK_SLOP) moved = true;
          this._pointer = p;
          if (moved && this.zoomMode !== 'none') {
            this.dragging = true;
            this.setTransform(t0.translate((p.x - start.x) / t0.k, (p.y - start.y) / t0.k));
          } else this.redraw();
        },
        up: (ux: number, uy: number) => {
          cap.up(ux, uy, null);
          this.dragging = false;
          if (!moved) this.emit('chartclick', { value: this.toCanvasPoint(ux, uy) });
          this.redraw();
        },
        cancel: () => {
          cap.cancel?.();
          this.dragging = false;
          this.redraw();
        },
      };
    }

    override wheel(dx: number, dy: number, x: number, y: number): boolean {
      // 有縮放時自己處理滾輪（以滑鼠位置為中心縮放）；沒有縮放時交給 UICanvas（有人收聽 wheel 才攔截）
      if (this.zoomMode === 'none' || this.attrs.pointerEvents === 'none') return super.wheel(dx, dy, x, y);
      const p = this.toCanvasPoint(x, y);
      const t = this._transform;
      const k = t.k * 2 ** (-dy * WHEEL_SPEED);
      const [min, max] = this.zoomExtent;
      const k2 = Math.min(max, Math.max(min, k));
      // 讓滑鼠下的那一點縮放前後在同一個位置
      const nx = p.x - ((p.x - t.x) * k2) / t.k;
      const ny = p.y - ((p.y - t.y) * k2) / t.k;
      this.setTransform(zoomIdentity.translate(nx, ny).scale(k2));
      if (this.hasListener('wheel')) this.emit('wheel', { value: { ...p, dx, dy } });
      return true;
    }
  };
}

/** 套件：安裝後介面 XML 可以用 <UID3Chart> */
export default pluginApi.plugin({
  name: 'd3-chart',
  version: '1.0.0',
  description: '用 d3.js 在 2D 介面、3D 面板畫互動圖表（懸停、縮放、平移、點擊）',
  setup(ctx: PluginContext) {
    ctx.registerUIComponent('UID3Chart', createD3ChartClass(ctx.api.ui2d.UICanvas));
  },
});
