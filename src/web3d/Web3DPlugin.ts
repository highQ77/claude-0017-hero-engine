import { CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, Entity } from '../ecs';
import { RENDER_DRAW_PRIORITY, type RenderPlugin } from '../render/RenderPlugin';
import { UIKey } from '../ui2d/keys';
import { WebPanel3D, WebPanel3DController } from './WebPanel3D';
import { Web3DKey } from './keys';
export { Web3DKey } from './keys';

/** Web3DPlugin 的設定 */
export interface Web3DPluginOptions {
  /** 用滑鼠操作網頁（預設 true；false 時網頁只顯示，滑鼠一律交給遊戲） */
  mouse?: boolean;
}

/**
 * 3D 網頁外掛：讓 WebPanel3D 實體顯示並可以操作。需先安裝 EcsPlugin 與 RenderPlugin。
 *
 * 網頁層放在畫布下面，畫布在網頁的位置是透明的（挖洞）。滑鼠移到露出來的網頁上時，
 * 畫布暫時不接收滑鼠，事件直接交給網頁；移出網頁後還給遊戲。
 * 2D 介面（UIPlugin）蓋在網頁上的地方，滑鼠照樣給 2D 介面。
 */
export class Web3DPlugin implements Plugin {
  readonly name = 'web3d';
  readonly dependencies = ['ecs', 'render'] as const;
  private _controller: WebPanel3DController | null = null;
  private ecs: EcsPlugin | null = null;
  private render: RenderPlugin | null = null;
  private cleanup: (() => void)[] = [];
  /** 滑鼠目前在哪個面板的網頁上（這時畫布不接收滑鼠） */
  private _active: Entity | null = null;

  /**
   * @param options 是否用滑鼠操作網頁
   */
  constructor(private readonly options: Web3DPluginOptions = {}) {}

  /** 網頁面板的控制器 */
  get controller(): WebPanel3DController {
    if (!this._controller) throw new Error('Web3DPlugin 尚未安裝');
    return this._controller;
  }

  /** 滑鼠目前所在的網頁面板（沒有時是 null） */
  get activePanel(): Entity | null {
    return this._active;
  }

  /**
   * @param engine 引擎
   */
  install(engine: Engine): void {
    const ecs = (this.ecs = engine.getPlugin<EcsPlugin>('ecs')!);
    const render = (this.render = engine.getPlugin<RenderPlugin>('render')!);
    ecs.world.setResource(Web3DKey, this);
    if (typeof document === 'undefined') return; // 沒有網頁（測試、伺服器）：不顯示
    const controller = (this._controller = new WebPanel3DController(ecs.world));
    const canvas = render.renderer.domElement as HTMLCanvasElement;
    // 網頁層：放在畫布下面、和畫布重疊（fixed：跟著畫布在視窗中的位置）
    const css = new CSS3DRenderer();
    const layer = css.domElement;
    Object.assign(layer.style, { position: 'fixed', left: '0', top: '0', zIndex: '0' });
    // 不能被捲動：iframe 裡點錨點連結（#段落）時，瀏覽器會連外層的捲動區域一起捲，好讓目標出現在畫面上。
    // overflow: hidden 的元素程式還是捲得動，網頁層被捲走後網頁就全部移出畫布的洞（變黑）。
    // clip 不是捲動區域；萬一還是被捲動（舊瀏覽器不支援 clip），立刻捲回原位
    layer.style.overflow = 'clip';
    const unscroll = () => {
      if (layer.scrollTop !== 0 || layer.scrollLeft !== 0) layer.scrollTo(0, 0);
    };
    layer.addEventListener('scroll', unscroll);
    canvas.parentElement?.insertBefore(layer, canvas);
    this.cleanup.push(() => layer.remove());
    // 畫布在上面（背景透明的地方會露出網頁）
    const prev = { position: canvas.style.position, zIndex: canvas.style.zIndex };
    if (getComputedStyle(canvas).position === 'static') canvas.style.position = 'relative';
    canvas.style.zIndex = '1';
    this.cleanup.push(() => {
      Object.assign(canvas.style, prev);
      canvas.style.pointerEvents = '';
    });

    ecs.addSystem({ name: 'web3d', priority: -900, run: () => controller.update() });
    // 變換同步之後、3D 畫面繪製之前：網頁跟著面板移動；跑到攝影機後面的面板連洞一起隱藏（同一幀生效）
    ecs.addSystem({
      name: 'web3d-sync',
      phase: 'render',
      priority: RENDER_DRAW_PRIORITY - 40,
      run: () => controller.sync(render.activeCameraObject),
    });
    // 3D 畫面畫完之後：網頁層用同一台攝影機畫
    let size = '';
    ecs.addSystem({
      name: 'web3d-draw',
      phase: 'render',
      priority: RENDER_DRAW_PRIORITY + 1,
      run: () => {
        const camera = render.activeCameraObject;
        if (!camera || controller.panels.size === 0) {
          layer.style.display = 'none';
          return;
        }
        layer.style.display = '';
        const r = canvas.getBoundingClientRect();
        const key = `${r.left}|${r.top}|${r.width}|${r.height}`;
        if (key !== size) {
          size = key;
          Object.assign(layer.style, { left: `${r.left}px`, top: `${r.top}px` });
          css.setSize(r.width, r.height);
        }
        css.render(controller.cssScene, camera);
      },
    });
    if (this.options.mouse !== false) this.attachMouse(canvas);
  }

  uninstall(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    this.ecs?.removeSystem('web3d').removeSystem('web3d-sync').removeSystem('web3d-draw');
    this.ecs?.world.removeResource(Web3DKey);
    this._controller?.dispose();
    this._controller = null;
    this._active = null;
    this.ecs = this.render = null;
  }

  /**
   * 畫面上這一點露出的是哪個網頁面板（被前面的物體或 2D 介面擋住時是 null）
   * @param clientX 視窗座標 X（滑鼠事件的 clientX）
   * @param clientY 視窗座標 Y
   */
  panelAt(clientX: number, clientY: number): Entity | null {
    const render = this.render;
    const controller = this._controller;
    if (!render || !controller || controller.panels.size === 0) return null;
    const canvas = render.renderer.domElement as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    if (clientX < r.left || clientY < r.top || clientX > r.right || clientY > r.bottom) return null;
    // 2D 介面蓋在上面
    const ui = this.ecs?.world.getResource(UIKey);
    if (
      ui?.hitTest(
        (clientX - r.left) * (canvas.clientWidth / r.width),
        (clientY - r.top) * (canvas.clientHeight / r.height),
      )
    )
      return null;
    // 最近的物體是不是某個面板的洞（前面有物體就不是）
    const hit = render.pick(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const st = hit ? controller.panelOfHole(hit.object) : null;
    if (!st) return null;
    return this.ecs?.world.get(st.entity, WebPanel3D)?.interactive === false ? null : st.entity;
  }

  /** 滑鼠在畫布上移動時判斷：移到露出的網頁上就讓畫布不接收滑鼠，事件直接到網頁；離開網頁元素時還原 */
  private attachMouse(canvas: HTMLCanvasElement): void {
    /** 目前所在面板的網頁元素（滑鼠在網頁上時） */
    let activeElement: HTMLElement | null = null;
    const leave = () => {
      activeElement?.removeEventListener('pointerleave', leave);
      activeElement = null;
      this._active = null;
      canvas.style.pointerEvents = '';
    };
    const enter = (entity: Entity) => {
      const st = this._controller?.panels.get(entity);
      if (!st) return;
      this._active = entity;
      activeElement = st.element;
      canvas.style.pointerEvents = 'none';
      // 離開網頁元素（或 iframe）的範圍：還給遊戲
      st.element.addEventListener('pointerleave', leave);
    };
    this.cleanup.push(() => activeElement?.removeEventListener('pointerleave', leave));
    const onMove = (e: PointerEvent) => {
      // 已經在網頁上：主頁面又收到移動、而且不在那個網頁元素裡，表示滑鼠已經離開網頁
      // （別的網域的 iframe（例如 YouTube）在獨立的程序裡，離開時 pointerleave 不一定會送到）
      if (activeElement) {
        if (!(e.target instanceof Node && activeElement.contains(e.target))) leave();
        return;
      }
      // 拖曳中（例如轉動視角）不要切換
      if (e.target !== canvas || e.buttons !== 0) return;
      const entity = this.panelAt(e.clientX, e.clientY);
      if (entity !== null) enter(entity);
    };
    window.addEventListener('pointermove', onMove, true);
    this.cleanup.push(() => window.removeEventListener('pointermove', onMove, true));
  }
}
