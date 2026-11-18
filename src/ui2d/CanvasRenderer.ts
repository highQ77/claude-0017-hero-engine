import type { UI2D } from './UI2D';
import { UIPainter, type Context2D } from './UIPainter';

/**
 * 顯示層介面：UI2D 排版或互動狀態改變後呼叫 render()。
 */
export interface UIRenderer {
  /** 連接到介面 */
  attach(ui: UI2D): void;
  /** 重畫 */
  render(): void;
  /** 釋放 */
  dispose(): void;
  /** 蓋在整個畫面（含介面）上的單色層，改透明度不用重畫介面（場景轉場的淡入淡出用；沒有時用介面圖層代替） */
  readonly fader?: ScreenFader;
}

/** 全螢幕單色層：opacity 0（看不到）～ 1（完全蓋住） */
export interface ScreenFader {
  /** 設定透明度（0 看不到 ~ 1 完全蓋住）與顏色 */
  set(opacity: number, color?: string): void;
}

/**
 * 獨立畫布顯示層（編輯器預覽、沒有 3D 引擎時使用）：
 * 在容器裡放一張畫布，用 UIPainter 繪製；滑鼠事件轉給 UI2D 處理。
 * 遊戲中請用 UIPlugin（把介面疊在 WebGL 畫面上）。
 */
export class CanvasUIRenderer implements UIRenderer {
  /** 繪製介面的畫布 */
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: Context2D;
  private ui: UI2D | null = null;
  private painter: UIPainter | null = null;
  private readonly cleanup: (() => void)[] = [];

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ui2d-canvas';
    Object.assign(this.canvas.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      touchAction: 'none',
    });
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** 連接到介面 */
  attach(ui: UI2D): void {
    this.ui = ui;
    this.painter = new UIPainter((url) => ui.imageSource(url));
    const local = (e: { clientX: number; clientY: number }) => {
      const r = this.canvas.getBoundingClientRect();
      // 容器可能被縮放（例如編輯器預覽），換算回介面座標
      const sx = r.width / (this.canvas.clientWidth || 1);
      const sy = r.height / (this.canvas.clientHeight || 1);
      return { x: (e.clientX - r.left) / sx, y: (e.clientY - r.top) / sy };
    };
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      this.canvas.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => this.canvas.removeEventListener(type, fn as EventListener, opts));
    };
    on('pointerdown', (e) => {
      const p = local(e);
      if (ui.handlePointer('down', p.x, p.y)) this.canvas.setPointerCapture(e.pointerId);
    });
    on('pointermove', (e) => {
      const p = local(e);
      ui.handlePointer('move', p.x, p.y);
      this.canvas.style.cursor = ui.cursor;
    });
    on('pointerup', (e) => {
      const p = local(e);
      ui.handlePointer('up', p.x, p.y);
    });
    on('pointerleave', () => ui.handlePointer('leave', 0, 0));
    // 收不到放開事件（觸控被取消、視窗失去焦點）：中斷拖曳
    on('pointercancel', () => ui.cancelPointer());
    const onBlur = () => ui.cancelPointer();
    window.addEventListener('blur', onBlur);
    this.cleanup.push(() => window.removeEventListener('blur', onBlur));
    on(
      'wheel',
      (e) => {
        const p = local(e);
        if (ui.handleWheel(e.deltaX, e.deltaY, p.x, p.y)) e.preventDefault();
      },
      { passive: false },
    );
  }

  /** 重畫 */
  render(): void {
    const ui = this.ui;
    if (!ui?.root || !this.painter) return;
    const { width, height } = ui.size;
    const pr = ui.pixelRatio;
    const w = Math.max(1, Math.round(width * pr));
    const h = Math.max(1, Math.round(height * pr));
    const regions = ui.consumeDamage();
    const resized = this.canvas.width !== w || this.canvas.height !== h;
    if (resized) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (regions && !resized) {
      // 局部重畫
      for (const r of regions) this.painter.paint(this.ctx, ui.root, width, height, pr, ui.paintState, r);
      return;
    }
    this.painter.paint(this.ctx, ui.root, width, height, pr, ui.paintState);
  }

  /** 移除畫布並釋放 */
  dispose(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    this.canvas.remove();
  }
}
