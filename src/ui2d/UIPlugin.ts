import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { tsl } from '../render/tsl';
import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, World } from '../ecs';
import type { RenderPlugin } from '../render/RenderPlugin';
import type { ScreenFader, UIRenderer } from './CanvasRenderer';
import { UI2D, type UI2DOptions } from './UI2D';
import { UIPainter, type Context2D } from './UIPainter';
import { UIScrollView, type UICanvasLayers, type UIElement } from './elements';
import { num } from './draw';
import { UICanvas } from './widgets/canvas';
import type { UIWeb } from './widgets/web';
import { type UITextureCopier, UITextureRenderer } from './UITexture';
import { UIKey } from './keys';
import { UIWebLayer } from './web2d';
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

/** 只走訪、不畫的 2D context（檢查「有沒有東西蓋在畫布上面」用） */
function nullContext(): Context2D {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const target: Record<string | symbol, unknown> = {
    measureText: (t: string) => ({ width: t.length * 6, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createConicGradient: () => gradient,
    createPattern: () => null,
    getTransform: () => new DOMMatrix(),
  };
  return new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : noop),
    set: (t, key, value) => {
      t[key] = value;
      return true;
    },
  }) as unknown as Context2D;
}

/** 畫布分層的四邊形（所有畫布共用一個平面） */
const LAYER_PLANE = new THREE.PlaneGeometry(1, 1);

/** 一塊畫布的四邊形：貼圖、圓角（和介面一樣裁成圓角）、透明度 */
interface CanvasLayerMesh extends THREE.Mesh {
  userData: {
    size: { value: THREE.Vector2 };
    radius: { value: number };
    scale: { value: number };
    opacity: { value: number };
  };
}

/**
 * encoded：貼圖存的是預乘 alpha 的 sRGB 值（共用模式的 WebGL2D 輸出貼圖），在這裡還原成線性、未預乘的顏色
 */
function createLayerMesh(texture: THREE.Texture, encoded: boolean): CanvasLayerMesh {
  const { abs, clamp, float, length, max, min, sRGBTransferEOTF, texture: textureNode, uniform, uv, vec4 } = tsl;
  const size = uniform(new THREE.Vector2(1, 1));
  const radius = uniform(0);
  const scale = uniform(1);
  const opacity = uniform(1);
  // 圓角矩形的距離（CSS 像素）：邊緣一個實體像素的反鋸齒
  const p = uv().sub(0.5).mul(size);
  const q = abs(p).sub(size.mul(0.5)).add(radius);
  const d = length(max(q, 0))
    .add(min(max(q.x, q.y), 0))
    .sub(radius);
  const mask = clamp(float(0.5).sub(d.mul(scale)), 0, 1);
  const raw = textureNode(texture);
  const c = encoded ? vec4(sRGBTransferEOTF(raw.rgb.div(max(raw.a, 1e-5))), raw.a) : raw;
  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  material.toneMapped = false;
  material.colorNode = vec4(c.rgb, c.a.mul(mask).mul(opacity));
  const mesh = new THREE.Mesh(LAYER_PLANE, material) as unknown as CanvasLayerMesh;
  mesh.userData = { size, radius, scale, opacity };
  mesh.frustumCulled = false;
  mesh.renderOrder = 1; // 介面之上
  return mesh;
}

/** UIPlugin 的設定 */
export interface UIPluginOptions extends Omit<UI2DOptions, 'container' | 'renderer'> {
  /** 建立時就載入的介面檔 */
  scene?: string;
}

/**
 * 引擎內的介面顯示層：把介面畫在一張畫布上，當作貼圖疊在 3D 畫面上（正交攝影機）。
 * 不使用 HTML 元素；介面有變動時才重畫畫布，平常每幀只畫一個面片。
 */
class EngineUIRenderer implements UIRenderer {
  private readonly target: UITextureRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh;
  private removeOverlay: (() => void) | null = null;
  readonly fader: GpuScreenFader;
  private ui: UI2D | null = null;
  /** 分層顯示中的畫布 → 疊在介面上的四邊形 */
  private readonly layers = new Map<UICanvas, CanvasLayerMesh>();
  /** 檢查畫布上面有沒有東西用（只走訪、不畫） */
  private readonly probe = new UIPainter(() => undefined);
  private readonly probeCtx = nullContext();
  /**
   * 畫布分層：UICanvas 的內容用它自己的貼圖疊在介面上，畫圖時介面不用重畫、不用上傳。
   * 每次介面重畫前決定哪些畫布可以分層（見 updateLayers）
   */
  readonly canvasLayers: UICanvasLayers;

  constructor(render3d: RenderPlugin) {
    this.canvasLayers = {
      isLayered: (el) => this.layers.has(el as UICanvas),
      // 畫布的貼圖已經標記要更新；遊戲暫停時主迴圈不會繪製：補畫一次
      contentChanged: () => {
        if (render3d.engineState !== 'running') render3d.draw();
      },
      // 3D 畫面用 WebGL 2（不支援 WebGPU 的瀏覽器）：畫布借用它的 WebGL 直接畫，疊上介面、貼到 3D 都不用複製
      sharedGL: () => {
        if (render3d.gpuApi !== 'webgl2') return null;
        const renderer = render3d.renderer;
        const gl = (renderer.backend as unknown as { gl?: WebGL2RenderingContext }).gl;
        return gl ? { gl, resetState: () => renderer.resetState() } : null;
      },
    };
    this.fader = new GpuScreenFader(render3d);
    this.target = new UITextureRenderer(
      (ui) => {
        this.quad.visible = !!ui.root;
        // 遊戲暫停時主迴圈不會繪製：補畫一次，介面變化才看得到
        if (render3d.engineState !== 'running') render3d.draw();
      },
      // 局部更新：繪製器初始化完成後才能複製貼圖
      () => (render3d.gpuApi ? (render3d.renderer as unknown as UITextureCopier) : null),
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
    this.ui = ui;
    this.target.attach(ui);
  }

  render(): void {
    this.updateLayers();
    this.target.render();
  }

  /**
   * 決定哪些畫布分層顯示，並擺好它們的四邊形（介面重畫前呼叫：排版、蓋在上面的東西改變時介面一定會重畫）。
   * 不能分層的（有東西蓋在上面、在捲動區裡、還沒畫過）照舊複製進介面。
   * 分層與否改變時，標記那塊重畫（介面要改成畫或不畫畫布的內容）
   */
  private updateLayers(): void {
    const ui = this.ui;
    const next = new Map<UICanvas, { x: number; y: number; w: number; h: number; radius: number; opacity: number }>();
    if (ui?.root) {
      const { width, height } = ui.size;
      const visit = (el: UIElement, opacity: number, clipped: boolean): void => {
        if (!el.visible) return;
        const o = opacity * (el.attrs.opacity !== undefined ? num(el.attrs.opacity, 1) : 1) * Math.max(0, el.alpha);
        if (o <= 0.001) return;
        if (el instanceof UICanvas && !clipped && el.hasContext) {
          const r = el.absoluteRect;
          if (r.width > 0 && r.height > 0 && !this.covered(ui, el, r, width, height))
            next.set(el, { x: r.x, y: r.y, w: r.width, h: r.height, radius: num(el.attrs.radius, 0), opacity: o });
        }
        for (const c of el.children) visit(c, o, clipped || el instanceof UIScrollView);
      };
      visit(ui.root, 1, false);
    }
    // 分層與否改變：那一塊要重畫；剛改成分層的要把最新內容上傳到它的貼圖
    for (const [el, mesh] of this.layers)
      if (!next.has(el)) {
        this.scene.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        this.layers.delete(el);
        if (!el.isDestroyed) ui?.damage(el);
      }
    for (const [el, r] of next) {
      let mesh = this.layers.get(el);
      if (!mesh) {
        const layer = el.layerTexture;
        if (!layer.encoded) layer.texture.needsUpdate = true; // 共用模式的貼圖本來就在 GPU 上
        mesh = createLayerMesh(layer.texture, layer.encoded);
        this.scene.add(mesh);
        this.layers.set(el, mesh);
        ui?.damage(el);
      }
      // 介面座標（CSS 像素，左上原點）→ 正交攝影機的 -1..1
      const { width, height } = ui!.size;
      mesh.scale.set((r.w / width) * 2, (r.h / height) * 2, 1);
      mesh.position.set(((r.x + r.w / 2) / width) * 2 - 1, 1 - ((r.y + r.h / 2) / height) * 2, 0);
      const u = mesh.userData;
      u.size.value.set(r.w, r.h);
      u.radius.value = Math.min(r.radius, r.w / 2, r.h / 2);
      u.scale.value = ui!.pixelRatio;
      u.opacity.value = r.opacity;
    }
  }

  /** 畫布上面有沒有東西（在它之後才畫、而且碰到它的範圍；下拉選單、提示也算） */
  private covered(
    ui: UI2D,
    el: UIElement,
    r: { x: number; y: number; width: number; height: number },
    w: number,
    h: number,
  ): boolean {
    this.probe.paint(this.probeCtx, ui.root!, w, h, 1, { ...ui.paintState, paintAfter: el }, r);
    return this.probe.paintedCount > 0;
  }

  dispose(): void {
    for (const mesh of this.layers.values()) (mesh.material as THREE.Material).dispose();
    this.layers.clear();
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
  private web: UIWebLayer | null = null;

  private constructor(/** 介面（也可以用 world.requireResource(UIKey) 取得） */ readonly ui: UI2D) {}

  /**
   * @param options 大小、像素比、事件處理函式、斷點、量文字的方式等設定
   */
  static async create(options: UIPluginOptions = {}): Promise<UIPlugin> {
    // 先以無畫面模式建立（可以先載入介面），安裝到引擎時才接上顯示層
    const ui = await UI2D.create({ ...options, container: null, renderer: null });
    if (options.scene) await ui.load(options.scene);
    return new UIPlugin(ui);
  }

  /**
   * @param engine 引擎
   */
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
    // 網頁元件（<UIWeb>）：HTML 元素在畫布下面，每次繪製前跟著元件的位置
    if (typeof document !== 'undefined') {
      const web = (this.web = new UIWebLayer(ui, render));
      this.cleanup.push(
        render.onBeforeDraw(() => web.update()),
        () => web.dispose(),
      );
    }
  }

  /** 滑鼠目前所在的網頁元件（<UIWeb>；沒有時是 null） */
  get activeWeb(): UIWeb | null {
    return this.web?.activeElement ?? null;
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
