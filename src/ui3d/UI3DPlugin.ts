import * as THREE from 'three';
import type { Engine, Plugin } from '../core/Engine';
import type { EcsPlugin, Entity } from '../ecs';
import type { RenderPlugin } from '../render/RenderPlugin';
import type { UI2D, UIHandler, UITextureCopier } from '../ui2d';
import { registerSceneCodecs } from '../scene/SceneFile';
import { UI3DController, UIPanel3D, type PanelState } from './UI3D';
import { ui3dCodecs } from './sceneCodecs';
import { UI3DKey } from './keys';
export { UI3DKey } from './keys';

/** UI3DPlugin 的設定 */
export interface UI3DPluginOptions {
  /** 所有面板共用的事件處理函式 */
  handlers?: Record<string, UIHandler>;
  /** 接收瀏覽器的滑鼠事件（預設 true；關掉後可以自己呼叫 pointer() 驅動，例如準心或 VR 手把） */
  mouse?: boolean;
}

/** 射線打到面板的結果 */
export interface UI3DHit {
  /** 點到的面板實體 */
  entity: Entity;
  /** 面板的介面 */
  ui: UI2D;
  /** 面板介面上的座標（像素） */
  x: number;
  /** 點到的位置 Y（介面座標，像素） */
  y: number;
  /** 從攝影機到面板的距離 */
  distance: number;
}

type PointerKind = 'down' | 'move' | 'up';

/**
 * 3D 介面外掛：讓 UIPanel3D 實體顯示並可以操作。需先安裝 EcsPlugin 與 RenderPlugin。
 * 若也有 2D 介面（UIPlugin），2D 介面在最上層，會先處理滑鼠。
 * 點到面板的滑鼠事件不會傳給遊戲；點到面板透明的地方則照常穿透。
 */
export class UI3DPlugin implements Plugin {
  readonly name = 'ui3d';
  readonly dependencies = ['ecs', 'render'] as const;
  private _controller: UI3DController | null = null;
  private render: RenderPlugin | null = null;
  private ecs: EcsPlugin | null = null;
  private cleanup: (() => void)[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  /** 滑鼠目前所在的面板 */
  private hovered: PanelState | null = null;
  /** 按下中的面板：放開前所有移動都交給它（拖曳滑桿可以超出面板範圍） */
  private captured: PanelState | null = null;

  /** 所有面板共用的事件處理函式（隨時修改都會生效） */
  private readonly handlers: Record<string, UIHandler>;

  constructor(private readonly options: UI3DPluginOptions = {}) {
    this.handlers = { ...options.handlers };
  }

  /** 註冊或替換所有面板共用的事件處理函式（XML 裡用 onClick="名稱" 呼叫；面板自己的優先） */
  setHandler(name: string, handler: UIHandler): void {
    this.handlers[name] = handler;
  }

  /** 一次註冊多個所有面板共用的事件處理函式：ui3d.setHandlers({ buy: () => …, close: () => … }) */
  setHandlers(handlers: Record<string, UIHandler>): void {
    Object.assign(this.handlers, handlers);
  }

  /** 3D 介面面板的控制器 */
  get controller(): UI3DController {
    if (!this._controller) throw new Error('UI3DPlugin 尚未安裝');
    return this._controller;
  }

  /** 取得實體上面板的介面 */
  uiOf(entity: Entity): UI2D | null {
    return this._controller?.panels.get(entity)?.ui ?? null;
  }

  install(engine: Engine): void {
    const ecs = (this.ecs = engine.getPlugin<EcsPlugin>('ecs')!);
    const render = (this.render = engine.getPlugin<RenderPlugin>('render')!);
    const controller = (this._controller = new UI3DController(ecs.world, {
      handlers: this.handlers,
      // 遊戲暫停時主迴圈不會繪製：面板內容變了要補畫一次
      onPanelRendered: () => render.engineState !== 'running' && render.draw(),
      copier: () => (render.gpuApi ? (render.renderer as unknown as UITextureCopier) : null),
    }));
    ecs.world.setResource(UI3DKey, this);
    // 場景檔可以寫 UIPanel3D（有安裝場景外掛時）
    this.cleanup.push(registerSceneCodecs(ecs.world, ui3dCodecs));
    ecs.addSystem({ name: 'ui3d', priority: -900, run: () => controller.update() });
    // 變換同步之後、繪製之前：billboard 面板轉向攝影機
    ecs.addSystem({
      name: 'ui3d-billboard',
      phase: 'render',
      priority: 950,
      run: () => controller.faceCamera(render.activeCameraObject),
    });
    if (this.options.mouse !== false && typeof window !== 'undefined') this.attachMouse(render.renderer.domElement);
  }

  uninstall(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    this.ecs?.removeSystem('ui3d').removeSystem('ui3d-billboard');
    this.ecs?.world.removeResource(UI3DKey);
    this._controller?.dispose();
    this._controller = null;
    this.hovered = this.captured = null;
    this.ecs = this.render = null;
  }

  // ───────── 射線與指標 ─────────

  /**
   * 從畫面座標（-1~1）找最近、沒被擋住的面板。
   * 使用上一次繪製時的位置，也就是玩家眼睛看到的畫面。
   */
  hitTest(ndcX: number, ndcY: number): UI3DHit | null {
    const ray = this.rayFrom(ndcX, ndcY);
    if (!ray) return null;
    let best: { st: PanelState; x: number; y: number; distance: number } | null = null;
    for (const st of this.controller.panels.values()) {
      const p = this.project(st, ray, false);
      if (p && (!best || p.distance < best.distance)) best = { st, ...p };
    }
    if (!best?.st.ui) return null;
    const data = this.ecs!.world.get(best.st.entity, UIPanel3D);
    if (data?.depthTest !== false && this.occluded(ray, best.distance, best.st)) return null;
    return { entity: best.st.entity, ui: best.st.ui, x: best.x, y: best.y, distance: best.distance };
  }

  /**
   * 送出指標事件（滑鼠以外的操作方式也可以用，例如畫面中央的準心：pointer('down', 0, 0)）。
   * 回傳 true 表示面板用掉了這個事件（遊戲不該再處理）。
   */
  pointer(type: PointerKind, ndcX: number, ndcY: number): boolean {
    if (!this._controller) return false;
    // 拖曳中：移動與放開都交給按下的面板，射線改打在它的無限平面上
    if (this.captured) {
      const st = this.captured;
      const ray = this.rayFrom(ndcX, ndcY);
      const p = ray ? this.project(st, ray, true) : null;
      const used = st.ui?.handlePointer(type, p?.x ?? -1e6, p?.y ?? -1e6) ?? false;
      if (type === 'up') this.captured = null;
      return used || type !== 'move';
    }
    const hit = this.hitTest(ndcX, ndcY);
    const st = hit ? this.controller.panels.get(hit.entity)! : null;
    if (st && !this.isInteractive(st)) return false;
    if (this.hovered && this.hovered !== st) this.hovered.ui?.handlePointer('leave', 0, 0);
    this.hovered = st;
    if (!st || !hit) return false;
    const used = hit.ui.handlePointer(type, hit.x, hit.y);
    if (type === 'down' && used) this.captured = st;
    return used;
  }

  /** 滾輪：捲動滑鼠下的面板列表 */
  wheel(deltaX: number, deltaY: number, ndcX: number, ndcY: number): boolean {
    const hit = this.hitTest(ndcX, ndcY);
    if (!hit) return false;
    const st = this.controller.panels.get(hit.entity)!;
    if (!this.isInteractive(st)) return false;
    return hit.ui.handleWheel(deltaX, deltaY, hit.x, hit.y);
  }

  /** 滑鼠所在面板應該顯示的游標（不在面板上時為 null） */
  get cursor(): string | null {
    return (this.captured ?? this.hovered)?.ui?.cursor ?? null;
  }

  private isInteractive(st: PanelState): boolean {
    return this.ecs?.world.get(st.entity, UIPanel3D)?.interactive !== false;
  }

  private rayFrom(ndcX: number, ndcY: number): THREE.Ray | null {
    const camera = this.render?.activeCameraObject;
    if (!camera) return null;
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc.set(ndcX, ndcY), camera);
    return this.raycaster.ray;
  }

  /**
   * 射線與面板平面的交點 → 介面像素座標。
   * unbounded 為 true 時不檢查是否在面板範圍內（拖曳用）。
   */
  private project(
    st: PanelState,
    ray: THREE.Ray,
    unbounded: boolean,
  ): { x: number; y: number; distance: number } | null {
    const data = this.ecs!.world.get(st.entity, UIPanel3D);
    if (!data || !st.ui || !st.group.visible || !visibleInScene(st.group)) return null;
    st.mesh.updateWorldMatrix(true, false);
    const inv = _m.copy(st.mesh.matrixWorld).invert();
    const local = _r.copy(ray).applyMatrix4(inv);
    if (Math.abs(local.direction.z) < 1e-9) return null;
    const t = -local.origin.z / local.direction.z;
    if (t <= 0 && !unbounded) return null;
    // 背面：單面材質時看不到也點不到
    if (!data.doubleSided && local.direction.z > 0 && !unbounded) return null;
    const p = local.at(t, _v);
    const u = p.x / st.worldWidth + 0.5;
    const v = 0.5 - p.y / st.worldHeight;
    if (!unbounded && (u < 0 || u > 1 || v < 0 || v > 1)) return null;
    const distance = p.applyMatrix4(st.mesh.matrixWorld).distanceTo(ray.origin);
    return { x: u * st.width, y: v * st.height, distance };
  }

  /** 面板前面有沒有其他（不透明的網格）物體擋住 */
  private occluded(ray: THREE.Ray, distance: number, self: PanelState): boolean {
    const render = this.render!;
    this.raycaster.far = distance - 1e-3;
    try {
      for (const hit of this.raycaster.intersectObjects(render.scene.children, true)) {
        const o = hit.object;
        if (!(o instanceof THREE.Mesh) || o === self.mesh || !visibleInScene(o)) continue;
        if (o.userData.ui3dPanel !== undefined) continue; // 其他面板由距離比較處理
        const m = o.material as THREE.Material;
        if (m.transparent && m.opacity < 0.5) continue;
        return true;
      }
      return false;
    } finally {
      this.raycaster.far = Infinity;
      void ray;
    }
  }

  /**
   * 瀏覽器滑鼠：掛在畫布上層元素的捕獲階段 —
   * 在 2D 介面（window 捕獲階段）之後、遊戲輸入（畫布與冒泡階段）之前處理。
   */
  private attachMouse(canvas: HTMLCanvasElement): void {
    const host = canvas.parentElement ?? document.body;
    const toNdc = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    };
    const listen = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts: AddEventListenerOptions = {},
    ) => {
      const options = { capture: true, ...opts };
      target.addEventListener(type, fn as EventListener, options);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, options));
    };
    let lastCursor: string | null = null;
    const updateCursor = () => {
      const c = this.cursor;
      if (c !== null) canvas.style.cursor = c;
      else if (lastCursor !== null) canvas.style.cursor = '';
      lastCursor = c;
    };
    listen(host, 'pointerdown', (e) => {
      if (e.target !== canvas || e.button !== 0) return;
      const p = toNdc(e);
      if (this.pointer('down', p.x, p.y)) e.stopPropagation();
      updateCursor();
    });
    listen(host, 'pointermove', (e) => {
      if (e.target !== canvas && !this.captured) return;
      const p = toNdc(e);
      const used = this.pointer('move', p.x, p.y);
      if (used && this.captured) e.stopPropagation();
      updateCursor();
    });
    // 放開可能發生在畫布外：聽 window
    listen(window, 'pointerup', (e) => {
      if (!this.captured) return;
      const p = toNdc(e);
      this.pointer('up', p.x, p.y);
      e.stopPropagation();
      updateCursor();
    });
    listen(
      host,
      'wheel',
      (e) => {
        if (e.target !== canvas) return;
        const p = toNdc(e);
        if (this.wheel(e.deltaX, e.deltaY, p.x, p.y)) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      { passive: false },
    );
    // 收不到放開事件（觸控被取消、視窗失去焦點）：中斷面板上的拖曳
    const cancel = () => {
      if (!this.captured) return;
      this.captured.ui?.cancelPointer();
      this.captured = null;
      updateCursor();
    };
    listen(window, 'pointercancel', cancel);
    listen(window, 'blur', cancel);
    listen(canvas, 'pointerleave', () => {
      if (this.captured) return;
      this.hovered?.ui?.handlePointer('leave', 0, 0);
      this.hovered = null;
      updateCursor();
    });
  }
}

function visibleInScene(o: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

const _m = new THREE.Matrix4();
const _r = new THREE.Ray();
const _v = new THREE.Vector3();
