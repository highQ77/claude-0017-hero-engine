import * as THREE from 'three';
import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, World } from '../ecs';
import type { RenderPlugin } from '../render/RenderPlugin';
import type { ScreenFader, UIRenderer } from './CanvasRenderer';
import { UI2D, type UI2DOptions } from './UI2D';
import { UITextureRenderer } from './UITexture';
import { UIKey } from './keys';
export { UIKey } from './keys';

/** 介面疊加圖層的順序（越大越上面） */
export const UI_OVERLAY_ORDER = 100;
/** 全螢幕淡入淡出層：在介面上面 */
export const FADE_OVERLAY_ORDER = 200;

/**
 * 用一個全螢幕面片做淡入淡出：只改材質的透明度，不會重畫介面的畫布。
 * （用介面圖層做的話，每一幀都要重畫並上傳整張介面貼圖，高解析度螢幕會掉幀）
 */
class GpuScreenFader implements ScreenFader {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  private readonly removeOverlay: () => void;

  constructor(private readonly render3d: RenderPlugin) {
    this.quad.frustumCulled = false;
    this.quad.visible = false;
    this.scene.add(this.quad);
    this.removeOverlay = render3d.addOverlay(this.scene, this.camera, FADE_OVERLAY_ORDER);
  }

  set(opacity: number, color?: string): void {
    const o = Math.min(1, Math.max(0, opacity));
    if (color !== undefined) this.material.color.setStyle(color);
    this.material.opacity = o;
    this.quad.visible = o > 0;
    // 遊戲暫停時主迴圈不會繪製：補畫一次
    if (this.render3d.engineState !== 'running') this.render3d.draw();
  }

  dispose(): void {
    this.removeOverlay();
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}

/** UIPlugin 的設定 */
export interface UIPluginOptions extends Omit<UI2DOptions, 'container' | 'renderer'> {
  /** 建立時就載入的介面檔 */
  scene?: string;
}

/**
 * 引擎內的介面顯示層：把介面畫在一張畫布上，當作貼圖疊在 WebGL 畫面上（正交攝影機）。
 * 不使用 HTML 元素；介面有變動時才重畫畫布，平常每幀只畫一個面片。
 */
class EngineUIRenderer implements UIRenderer {
  private readonly target: UITextureRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private removeOverlay: (() => void) | null = null;
  readonly fader: GpuScreenFader;

  constructor(render3d: RenderPlugin) {
    this.fader = new GpuScreenFader(render3d);
    this.target = new UITextureRenderer(
      () => render3d.renderer,
      (ui) => {
        this.quad.visible = !!ui.root;
        // 遊戲暫停時主迴圈不會繪製：補畫一次，介面變化才看得到
        if (render3d.engineState !== 'running') render3d.draw();
      },
    );
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({
        map: this.target.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false, // 介面顏色不受色調映射影響
      }),
    );
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.removeOverlay = render3d.addOverlay(this.scene, this.camera, UI_OVERLAY_ORDER);
  }

  /** 統計：完整上傳與局部上傳的次數（效能分析用） */
  get uploadStats() {
    return this.target.uploadStats;
  }

  attach(ui: UI2D): void {
    this.target.attach(ui);
  }

  render(): void {
    this.target.render();
  }

  dispose(): void {
    this.removeOverlay?.();
    this.removeOverlay = null;
    this.fader.dispose();
    this.target.dispose();
    this.quad.geometry.dispose();
    (this.quad.material as THREE.Material).dispose();
  }
}

/**
 * 2D 介面外掛：介面由引擎繪製並疊在 3D 畫面上；點到介面的滑鼠事件不會傳給遊戲，
 * 透明的地方則照常穿透到遊戲。需先安裝 RenderPlugin。
 * Yoga 需要非同步載入，請用 create()：
 * @example
 * const uiPlugin = await UIPlugin.create({ scene: 'ui/scene.xml', handlers: { pause: () => engine.pause() } });
 * engine.use(uiPlugin);
 */
export class UIPlugin implements Plugin {
  readonly name = 'ui2d';
  readonly dependencies = ['render'] as const;
  private world: World | null = null;
  private cleanup: (() => void)[] = [];
  /**
   * 處理滑鼠、觸控（預設 true）。false 時介面只顯示、不攔截任何指標事件，
   * 點擊全部穿透到下面的遊戲（例如 3D 場景編輯器預覽介面時）。
   */
  interactive = true;

  private constructor(/** 介面（也可以用 world.requireResource(UIKey) 取得） */ readonly ui: UI2D) {}

  static async create(options: UIPluginOptions = {}): Promise<UIPlugin> {
    // 先以無畫面模式建立（可以先載入介面），安裝到引擎時才接上顯示層
    const ui = await UI2D.create({ ...options, container: null, renderer: null });
    if (options.scene) await ui.load(options.scene);
    return new UIPlugin(ui);
  }

  install(engine: Engine): void {
    const render = engine.getPlugin<RenderPlugin>('render')!;
    const ui = this.ui;
    ui.pixelRatio = render.renderer.getPixelRatio();
    ui.setRenderer(new EngineUIRenderer(render));
    ui.resize(render.size.width, render.size.height);
    this.cleanup.push(render.onResize((w, h) => ui.resize(w, h)));

    const ecs = engine.getPlugin<EcsPlugin>('ecs');
    if (ecs) {
      this.world = ecs.world;
      ecs.world.setResource(UIKey, ui);
    }
    if (typeof window !== 'undefined') this.attachInput(render.renderer.domElement);
  }

  uninstall(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    if (this.world?.getResource(UIKey) === this.ui) this.world.removeResource(UIKey);
    this.world = null;
    this.ui.destroy();
  }

  /**
   * 在 window 的捕獲階段先處理指標事件：點到介面就停止傳遞，
   * 遊戲的輸入外掛（掛在畫布與 window 冒泡階段）就不會收到。
   */
  private attachInput(canvas: HTMLCanvasElement): void {
    const ui = this.ui;
    let capturing = false;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      // 畫布可能被 CSS 縮放（例如編輯器的預覽視窗），換算回介面座標
      const sx = r.width / (canvas.clientWidth || r.width || 1);
      const sy = r.height / (canvas.clientHeight || r.height || 1);
      return {
        x: (e.clientX - r.left) / sx,
        y: (e.clientY - r.top) / sy,
        inside: e.clientX >= r.left && e.clientY >= r.top && e.clientX <= r.right && e.clientY <= r.bottom,
      };
    };
    const listen = <K extends keyof WindowEventMap>(
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts: AddEventListenerOptions = {},
    ) => {
      const options = { capture: true, ...opts };
      // interactive 為 false 時不處理（取消、失去焦點照常處理，避免卡在拖曳中）
      const always = type === 'pointercancel' || type === 'blur';
      const handler = ((e: WindowEventMap[K]) => {
        if (always || this.interactive) fn(e);
      }) as EventListener;
      window.addEventListener(type, handler, options);
      this.cleanup.push(() => window.removeEventListener(type, handler, options));
    };
    // 蓋在畫布上的 HTML 元素（例如 lil-gui 調整面板、對話框）：點擊交給它們，不要被介面攔截
    const onOtherElement = (e: Event) => e.target instanceof Element && e.target !== canvas;
    listen('pointerdown', (e) => {
      const p = local(e);
      if (!p.inside || onOtherElement(e)) return;
      if (ui.handlePointer('down', p.x, p.y)) {
        capturing = true;
        e.stopPropagation();
      }
    });
    listen('pointermove', (e) => {
      const p = local(e);
      const used = ui.handlePointer('move', p.x, p.y);
      canvas.style.cursor = ui.cursor;
      if (capturing && used) e.stopPropagation(); // 拖曳捲動中
    });
    listen('pointerup', (e) => {
      const p = local(e);
      ui.handlePointer('up', p.x, p.y);
      if (capturing) {
        capturing = false;
        e.stopPropagation();
      }
    });
    listen(
      'wheel',
      (e) => {
        const p = local(e);
        if (!p.inside || onOtherElement(e)) return;
        if (ui.handleWheel(e.deltaX, e.deltaY, p.x, p.y)) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      { passive: false },
    );
    canvas.addEventListener('pointerleave', () => this.interactive && ui.handlePointer('leave', 0, 0));
    // 收不到放開事件的情況：觸控被瀏覽器取消、視窗失去焦點 → 中斷拖曳，介面不會卡在拖曳中
    const cancel = () => {
      capturing = false;
      ui.cancelPointer();
    };
    listen('pointercancel', cancel);
    listen('blur', cancel);
    // 觸控拖曳（滑桿、搖桿、物品）時不要讓瀏覽器拿去捲動或縮放頁面
    canvas.style.touchAction = 'none';
  }
}
