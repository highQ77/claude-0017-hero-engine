/**
 * 攝影機繞轉控制（orbit control）：用滑鼠或手指繞著目標點轉動、縮放、平移攝影機。
 *
 *   左鍵拖曳／單指拖曳　　繞著目標轉動
 *   滾輪／雙指捏合　　　　拉近、拉遠
 *   右鍵、Shift＋左鍵拖曳／雙指拖曳　平移
 *
 * 用法：把 OrbitControl 加到攝影機實體上（需要 Transform），或用 RenderPlugin({ orbitControls: true }) 自動控制目前的攝影機。
 *
 *   const camera = spawn.camera(world, { position: [0, 2, 6] });
 *   world.add(camera, OrbitControl, { target: new THREE.Vector3(0, 0.5, 0), maxDistance: 20 });
 *
 * 點到 2D 介面（UIPlugin）的操作不會轉動攝影機；攝影機要是最上層的實體（沒有父節點）。
 */
import * as THREE from 'three';
import type { Entity, World } from '../ecs';
import { defineComponent } from '../ecs/Component';
import { Parent, Transform, type TransformData } from '../scene';
import { lookAt } from '../scene/Transform';
import { Camera } from './components';
import { CameraFollow } from './CameraRig';

/** 攝影機繞轉控制的設定 */
export interface OrbitControlData {
  /** 是否啟用 */
  enabled: boolean;
  /** 繞著這一點轉動；null：從攝影機目前的朝向推算（看向原點附近時就是原點） */
  target: THREE.Vector3 | null;
  /** 可以轉動 */
  rotate: boolean;
  /** 可以縮放 */
  zoom: boolean;
  /** 可以平移 */
  pan: boolean;
  /** 轉動速度倍率 */
  rotateSpeed: number;
  /** 縮放速度倍率 */
  zoomSpeed: number;
  /** 平移速度倍率 */
  panSpeed: number;
  /** 和目標的距離範圍 */
  minDistance: number;
  /** 最遠的距離 */
  maxDistance: number;
  /** 上下角度範圍（弧度，0 = 從正上方往下看，π = 從正下方往上看） */
  minPolarAngle: number;
  /** 最大的上下角度（π/2 為水平，不能轉到地面以下） */
  maxPolarAngle: number;
  /** 慣性（秒）：放開後慢慢停下；0 為沒有慣性 */
  damping: number;
  /** 自動繞著目標轉（弧度／秒），使用者操作時暫停 */
  autoRotate: number;
  /**
   * 使用者第一次操作之前不動攝影機（遊戲或範例自己的攝影機動畫照常運作），操作後才接手。
   * RenderPlugin({ orbitControls }) 自動加的控制是 true。
   */
  waitForInput: boolean;
  /** 滾輪只在點過畫面之後才縮放（嵌在頁面裡時，捲動頁面不會不小心縮放），預設 false */
  wheelNeedsFocus: boolean;
}

/** 攝影機繞轉控制元件：滑鼠拖曳轉動、滾輪縮放、右鍵平移（加在攝影機上） */
export const OrbitControl = defineComponent<OrbitControlData>('OrbitControl', () => ({
  enabled: true,
  target: null,
  rotate: true,
  zoom: true,
  pan: true,
  rotateSpeed: 1,
  zoomSpeed: 1,
  panSpeed: 1,
  minDistance: 0.5,
  maxDistance: 500,
  minPolarAngle: 0.01,
  maxPolarAngle: Math.PI - 0.01,
  damping: 0.08,
  autoRotate: 0,
  waitForInput: false,
  wheelNeedsFocus: false,
}));

/** 每個被控制的攝影機的執行狀態（不放在元件裡：元件只放設定） */
interface State {
  target: THREE.Vector3;
  spherical: THREE.Spherical;
  /** 還沒套用的變化（有慣性時每幀套用一部分） */
  theta: number;
  phi: number;
  zoom: number;
  pan: THREE.Vector3;
  /** 使用者操作過了（waitForInput 時才開始控制） */
  engaged: boolean;
  /** 正在拖曳（暫停自動旋轉） */
  dragging: boolean;
}

const _offset = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

/** 從攝影機目前的位置、朝向推算目標點：朝向上離原點最近的點（太近或在背後時取前方 5 公尺） */
function guessTarget(t: TransformData, out: THREE.Vector3): THREE.Vector3 {
  _forward.set(0, 0, -1).applyQuaternion(t.rotation);
  const along = -t.position.dot(_forward);
  return out.copy(t.position).addScaledVector(_forward, along > 0.5 ? along : 5);
}

/**
 * 處理畫布上的指標事件，並在每幀更新有 OrbitControl 的攝影機（由 RenderPlugin 建立）。
 */
export class OrbitController {
  private readonly states = new Map<Entity, State>();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private mode: 'rotate' | 'pan' | null = null;
  private pinch: { distance: number; x: number; y: number } | null = null;
  private focused = false;
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly world: World,
    private readonly canvas: HTMLCanvasElement,
    /** 目前負責繪製的攝影機 */
    private readonly activeCamera: () => Entity | null,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, options);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, options));
    };
    on(canvas, 'pointerdown', (e) => this.onDown(e));
    on(window, 'pointermove', (e) => this.onMove(e));
    on(window, 'pointerup', (e) => this.onUp(e));
    on(window, 'pointercancel', (e) => this.onUp(e));
    on(canvas, 'pointerleave', () => {
      if (this.pointers.size === 0) this.focused = false;
    });
    on(canvas, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(canvas, 'contextmenu', (e) => {
      if (this.control()?.data.pan) e.preventDefault(); // 右鍵用來平移
    });
  }

  /** 移除事件監聽 */
  dispose(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    this.states.clear();
  }

  /** 每幀：套用操作、慣性、自動旋轉，寫回攝影機的 Transform */
  update(dt: number): void {
    const cam = this.activeCamera();
    this.canvas.style.touchAction = cam !== null && this.world.has(cam, OrbitControl) ? 'none' : '';
    for (const e of this.states.keys())
      if (!this.world.isAlive(e) || !this.world.has(e, OrbitControl)) this.states.delete(e);
    this.world.query([Transform, OrbitControl]).each((e, t, c) => {
      if (!c.enabled || this.world.has(e, Parent)) return;
      const s = this.stateOf(e, t, c);
      if (c.waitForInput && !s.engaged) {
        // 還沒操作過：跟著攝影機目前的位置（不寫回），之後從這裡開始轉
        if (!c.target) guessTarget(t, s.target);
        s.spherical.setFromVector3(_offset.copy(t.position).sub(s.target));
        return;
      }
      if (c.autoRotate && !s.dragging) s.theta -= c.autoRotate * dt;
      const idle =
        Math.abs(s.theta) < 1e-6 && Math.abs(s.phi) < 1e-6 && Math.abs(s.zoom) < 1e-6 && s.pan.lengthSq() < 1e-12;
      if (idle) {
        // 沒有操作：不寫回，改跟著攝影機目前的位置（遊戲程式移動攝影機後，下次從那裡接著轉）
        s.theta = s.phi = s.zoom = 0;
        s.pan.set(0, 0, 0);
        if (c.target) s.target.copy(c.target);
        s.spherical.setFromVector3(_offset.copy(t.position).sub(s.target));
        return;
      }
      const k = c.damping > 0 ? 1 - Math.exp(-dt / c.damping) : 1;
      const sp = s.spherical;
      sp.theta += s.theta * k;
      sp.phi = THREE.MathUtils.clamp(sp.phi + s.phi * k, c.minPolarAngle, c.maxPolarAngle);
      const cam = this.world.get(e, Camera);
      if (cam?.kind === 'orthographic') {
        // 正交攝影機：距離不影響畫面大小，改它的 zoom
        cam.zoom = THREE.MathUtils.clamp(cam.zoom * Math.exp(-s.zoom * k), 0.01, 100);
      } else {
        sp.radius = THREE.MathUtils.clamp(sp.radius * Math.exp(s.zoom * k), c.minDistance, c.maxDistance);
      }
      s.target.addScaledVector(s.pan, k);
      s.theta *= 1 - k;
      s.phi *= 1 - k;
      s.zoom *= 1 - k;
      s.pan.multiplyScalar(1 - k);
      if (c.target) c.target.copy(s.target);
      sp.makeSafe();
      t.position.copy(s.target).add(_offset.setFromSpherical(sp));
      lookAt(t, s.target);
    });
  }

  private stateOf(e: Entity, t: TransformData, c: OrbitControlData): State {
    let s = this.states.get(e);
    if (!s) {
      const target = c.target ? c.target.clone() : guessTarget(t, new THREE.Vector3());
      s = {
        target,
        spherical: new THREE.Spherical().setFromVector3(_offset.copy(t.position).sub(target)),
        theta: 0,
        phi: 0,
        zoom: 0,
        pan: new THREE.Vector3(),
        engaged: false,
        dragging: false,
      };
      this.states.set(e, s);
    }
    return s;
  }

  /** 目前攝影機的控制（沒有或停用時是 null） */
  private control(): { entity: Entity; data: OrbitControlData; state: State } | null {
    const e = this.activeCamera();
    if (e === null) return null;
    const data = this.world.get(e, OrbitControl);
    const t = this.world.get(e, Transform);
    if (!data?.enabled || !t || this.world.has(e, Parent)) return null;
    return { entity: e, data, state: this.stateOf(e, t, data) };
  }

  private onDown(e: PointerEvent): void {
    const c = this.control();
    this.focused = true;
    if (!c) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      const wantsPan = e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey;
      this.mode = wantsPan ? (c.data.pan ? 'pan' : null) : c.data.rotate ? 'rotate' : null;
      this.pinch = null;
    } else if (this.pointers.size === 2) {
      this.mode = null;
      this.pinch = this.pinchInfo();
    }
  }

  private onMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const c = this.control();
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    if (!c || (dx === 0 && dy === 0)) return;
    const s = c.state;
    s.engaged = true;
    s.dragging = true;
    const h = this.canvas.clientHeight || 1;
    if (this.pointers.size >= 2 && this.pinch) {
      // 雙指：捏合縮放、一起移動平移
      const now = this.pinchInfo()!;
      if (c.data.zoom && now.distance > 0 && this.pinch.distance > 0)
        s.zoom += Math.log(this.pinch.distance / now.distance) * c.data.zoomSpeed;
      if (c.data.pan) this.addPan(c, now.x - this.pinch.x, now.y - this.pinch.y);
      this.pinch = now;
      return;
    }
    if (this.mode === 'rotate') {
      s.theta -= ((2 * Math.PI * dx) / h) * c.data.rotateSpeed;
      s.phi -= ((2 * Math.PI * dy) / h) * c.data.rotateSpeed;
    } else if (this.mode === 'pan') {
      this.addPan(c, dx, dy);
    }
  }

  private onUp(e: PointerEvent): void {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) {
      this.mode = null;
      const c = this.control();
      if (c) c.state.dragging = false;
    }
  }

  private onWheel(e: WheelEvent): void {
    const c = this.control();
    if (!c?.data.zoom) return;
    if (c.data.wheelNeedsFocus && !this.focused) return; // 讓頁面照常捲動
    e.preventDefault();
    // deltaMode 1 是「行」：換算成像素
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    c.state.zoom += THREE.MathUtils.clamp(delta, -200, 200) * 0.0005 * c.data.zoomSpeed; // 滾輪一格（120）約 6%
    c.state.engaged = true;
  }

  private pinchInfo(): { distance: number; x: number; y: number } | null {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return null;
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /** 平移：螢幕上移動多少像素，目標點就在畫面上移動多少（和距離、視角有關） */
  private addPan(c: { entity: Entity; data: OrbitControlData; state: State }, dx: number, dy: number): void {
    const t = this.world.get(c.entity, Transform)!;
    const cam = this.world.get(c.entity, Camera);
    const h = this.canvas.clientHeight || 1;
    const worldPerPixel =
      cam?.kind === 'orthographic'
        ? (2 * cam.size) / (cam.zoom || 1) / h
        : (2 * c.state.spherical.radius * Math.tan(THREE.MathUtils.degToRad((cam?.fov ?? 60) / 2))) / h;
    _right.set(1, 0, 0).applyQuaternion(t.rotation);
    _up.set(0, 1, 0).applyQuaternion(t.rotation);
    const k = worldPerPixel * c.data.panSpeed;
    c.state.pan.addScaledVector(_right, -dx * k).addScaledVector(_up, dy * k);
  }
}

/** 給 RenderPlugin 用：加到攝影機上的預設設定 */
export function autoOrbitControl(world: World, camera: Entity, settings: Partial<OrbitControlData>): void {
  // 已經有其他方式控制的攝影機（自己加的 OrbitControl、CameraFollow 跟隨）不要搶
  if (!world.has(camera, Transform) || world.has(camera, OrbitControl) || world.has(camera, CameraFollow)) return;
  world.add(camera, OrbitControl, { waitForInput: true, ...settings });
}
