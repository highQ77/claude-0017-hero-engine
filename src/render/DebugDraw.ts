/**
 * 除錯繪製：在 3D 畫面上畫線、射線、方框、球、點（render.debug），檢查 AI 視線、射線、範圍、路徑。
 *
 *   render.debug.line([0, 0, 0], [2, 1, 0]);                         // 這一幀畫一條線
 *   render.debug.ray(origin, direction, 5, { color: '#ff4040' });    // 射線
 *   render.debug.box(center, [1, 2, 1], { duration: 2 });             // 畫 2 秒
 *   render.debug.sphere(enemyPos, viewRange, { color: '#ffd166' });
 *   render.debug.path(points);                                        // 連起來的線
 *
 * - duration 沒給（或 0）：只畫這一幀，每幀要畫就每幀呼叫（例如寫在系統裡）；給秒數：畫那麼久（真實時間）
 * - 預設畫在最上面（不會被擋住）；depthTest: true 時會被前面的物體擋住
 * - 只是畫面上的線：不會被點選，也不會出現在場景檔裡；enabled = false 全部不畫（例如正式版）
 */
import * as THREE from 'three';
import { toVector3, type Vec3Like } from './descriptors';

/** 除錯繪製的設定 */
export interface DebugDrawOptions {
  /** 顏色（預設 '#9acd32'） */
  color?: THREE.ColorRepresentation;
  /** 畫幾秒（真實時間）；沒給或 0 只畫這一幀 */
  duration?: number;
  /** 會被前面的物體擋住（預設 false：永遠畫在最上面） */
  depthTest?: boolean;
}

interface Item {
  /** 線段的端點（兩個一組） */
  points: THREE.Vector3[];
  color: THREE.Color;
  /** 到這個時間（performance.now 毫秒）為止；null 代表只畫一幀 */
  until: number | null;
  depthTest: boolean;
}

const DEFAULT_COLOR = new THREE.Color('#9acd32');
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 一組線（一種 depthTest 一組） */
class LineLayer {
  readonly lines: THREE.LineSegments;
  private capacity = 0;

  constructor(depthTest: boolean) {
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      depthTest,
      depthWrite: false,
      transparent: true,
      toneMapped: false,
    });
    this.lines = new THREE.LineSegments(new THREE.BufferGeometry(), material);
    this.lines.frustumCulled = false;
    this.lines.raycast = () => {}; // 除錯線不能被點選（射線檢測略過）
    this.lines.renderOrder = depthTest ? 900 : 1000;
    this.lines.name = 'debug-draw';
  }

  /** 換上這一幀要畫的線段 */
  set(items: Item[]): void {
    let count = 0;
    for (const it of items) count += it.points.length;
    const g = this.lines.geometry;
    if (count > this.capacity) {
      this.capacity = Math.max(count, this.capacity * 2, 64);
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3));
    }
    this.lines.visible = count > 0;
    if (!count) return;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    let i = 0;
    for (const it of items)
      for (const p of it.points) {
        pos.setXYZ(i, p.x, p.y, p.z);
        col.setXYZ(i, it.color.r, it.color.g, it.color.b);
        i++;
      }
    g.setDrawRange(0, count);
    pos.needsUpdate = col.needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    (this.lines.material as THREE.Material).dispose();
  }
}

/**
 * 除錯繪製（render.debug）：畫線、射線、方框、球、點、路徑。沒給 duration 的只畫這一幀，給秒數的畫那麼久。
 * @example
 * render.debug.ray(eye, forward, 8, { color: '#ff4040' });
 */
export class DebugDraw {
  /** false 時全部不畫（呼叫也不會記下來） */
  enabled = true;
  /** 加到場景裡的物件（RenderPlugin 會放進場景） */
  readonly object = new THREE.Group();
  private items: Item[] = [];
  private readonly onTop = new LineLayer(false);
  private readonly depth = new LineLayer(true);

  constructor() {
    this.object.name = 'debug-draw';
    this.object.add(this.onTop.lines, this.depth.lines);
  }

  /** 畫一條線 */
  line(from: Vec3Like, to: Vec3Like, options: DebugDrawOptions = {}): void {
    this.push([toVector3(from), toVector3(to)], options);
  }

  /** 射線：從 origin 往 direction 畫 length 長（direction 不用是單位向量） */
  ray(origin: Vec3Like, direction: Vec3Like, length = 1, options: DebugDrawOptions = {}): void {
    const o = toVector3(origin);
    const d = toVector3(direction);
    if (d.lengthSq() === 0) return;
    const end = o.clone().addScaledVector(d.normalize(), length);
    // 末端畫一個小箭頭，看得出方向
    const side = new THREE.Vector3().crossVectors(
      d,
      Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0),
    );
    side.normalize().multiplyScalar(length * 0.06);
    const back = end.clone().addScaledVector(d, -length * 0.12);
    this.push([o, end, end, back.clone().add(side), end, back.clone().sub(side)], options);
  }

  /** 方框：中心與尺寸（[x, y, z] 或一個數字），或直接給 Box3 */
  box(center: Vec3Like | THREE.Box3, size: Vec3Like | number = 1, options: DebugDrawOptions = {}): void {
    let min: THREE.Vector3;
    let max: THREE.Vector3;
    if (center instanceof THREE.Box3) {
      if (center.isEmpty()) return;
      min = center.min;
      max = center.max;
    } else {
      const c = toVector3(center);
      const half = (typeof size === 'number' ? new THREE.Vector3(size, size, size) : toVector3(size)).multiplyScalar(
        0.5,
      );
      min = c.clone().sub(half);
      max = c.clone().add(half);
    }
    const v = (x: number, y: number, z: number) =>
      new THREE.Vector3(x ? max.x : min.x, y ? max.y : min.y, z ? max.z : min.z);
    const edges = [
      [0, 0, 0, 1, 0, 0],
      [0, 1, 0, 1, 1, 0],
      [0, 0, 1, 1, 0, 1],
      [0, 1, 1, 1, 1, 1],
      [0, 0, 0, 0, 1, 0],
      [1, 0, 0, 1, 1, 0],
      [0, 0, 1, 0, 1, 1],
      [1, 0, 1, 1, 1, 1],
      [0, 0, 0, 0, 0, 1],
      [1, 0, 0, 1, 0, 1],
      [0, 1, 0, 0, 1, 1],
      [1, 1, 0, 1, 1, 1],
    ];
    const pts: THREE.Vector3[] = [];
    for (const [a, b, c, d, e, f] of edges) pts.push(v(a, b, c), v(d, e, f));
    this.push(pts, options);
  }

  /** 球：三個方向的圓 */
  sphere(center: Vec3Like, radius = 1, options: DebugDrawOptions = {}): void {
    const c = toVector3(center);
    const pts: THREE.Vector3[] = [];
    const n = 24;
    for (let axis = 0; axis < 3; axis++)
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        const at = (a: number) => {
          const u = Math.cos(a) * radius;
          const w = Math.sin(a) * radius;
          return axis === 0
            ? new THREE.Vector3(c.x, c.y + u, c.z + w)
            : axis === 1
              ? new THREE.Vector3(c.x + u, c.y, c.z + w)
              : new THREE.Vector3(c.x + u, c.y + w, c.z);
        };
        pts.push(at(a0), at(a1));
      }
    this.push(pts, options);
  }

  /** 點：一個小十字 */
  point(position: Vec3Like, size = 0.2, options: DebugDrawOptions = {}): void {
    const p = toVector3(position);
    const h = size / 2;
    this.push(
      [
        new THREE.Vector3(p.x - h, p.y, p.z),
        new THREE.Vector3(p.x + h, p.y, p.z),
        new THREE.Vector3(p.x, p.y - h, p.z),
        new THREE.Vector3(p.x, p.y + h, p.z),
        new THREE.Vector3(p.x, p.y, p.z - h),
        new THREE.Vector3(p.x, p.y, p.z + h),
      ],
      options,
    );
  }

  /** 把一串點連成線（closed 時頭尾相連） */
  path(points: readonly Vec3Like[], options: DebugDrawOptions & { closed?: boolean } = {}): void {
    if (points.length < 2) return;
    const vs = points.map((p) => toVector3(p));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < vs.length - 1; i++) pts.push(vs[i], vs[i + 1]);
    if (options.closed) pts.push(vs[vs.length - 1], vs[0]);
    this.push(pts, options);
  }

  /** 清掉全部（包括還沒到時間的） */
  clear(): void {
    this.items = [];
    this.onTop.set([]);
    this.depth.set([]);
  }

  /** 目前記下來的圖形數量（測試、除錯用） */
  get count(): number {
    return this.items.length;
  }

  /** @internal 繪製前：更新要畫的線段（RenderPlugin 每次繪製前呼叫） */
  _beforeDraw(): void {
    const t = now();
    this.items = this.items.filter((it) => it.until === null || it.until > t);
    const visible = this.enabled ? this.items : [];
    this.onTop.set(visible.filter((it) => !it.depthTest));
    this.depth.set(visible.filter((it) => it.depthTest));
  }

  /** @internal 繪製後：只畫一幀的拿掉 */
  _afterDraw(): void {
    if (this.items.some((it) => it.until === null)) this.items = this.items.filter((it) => it.until !== null);
  }

  /** 釋放 GPU 資源（RenderPlugin 移除時呼叫） */
  dispose(): void {
    this.clear();
    this.onTop.dispose();
    this.depth.dispose();
  }

  private push(points: THREE.Vector3[], options: DebugDrawOptions): void {
    if (!this.enabled) return;
    this.items.push({
      points,
      color: options.color !== undefined ? new THREE.Color(options.color) : DEFAULT_COLOR,
      until: options.duration && options.duration > 0 ? now() + options.duration * 1000 : null,
      depthTest: options.depthTest ?? false,
    });
  }
}
