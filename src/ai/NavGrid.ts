import * as THREE from 'three';
import type { Entity, World } from '../ecs';
import type { Physics, Vec3 } from '../physics/Physics';
import { RigidBody } from '../physics/components';
import { HierarchyKey } from '../scene';

/** 導航網格的設定（範圍、格子大小） */
export interface NavGridOptions {
  /** 範圍（XZ 平面） */
  min: { x: number; z: number };
  /** 範圍的最大角（x、z） */
  max: { x: number; z: number };
  /** 格子大小（世界單位），預設 0.5 */
  cellSize?: number;
  /** 路徑點的高度 */
  y?: number;
}

/** 從物理碰撞體烘焙可走區域的設定 */
export interface BakeOptions {
  /** 偵測障礙物的高度（地面往上一點，避免偵測到地板） */
  probeY: number;
  /** 角色半徑：離障礙物多近算擋住 */
  agentRadius: number;
  /**
   * 要忽略的實體。預設忽略動態與運動學剛體（會移動的東西不算固定障礙）
   */
  ignore?: (entity: Entity) => boolean;
}

/** 找路的設定 */
export interface PathOptions {
  /** 允許斜走，預設 true */
  diagonal?: boolean;
  /** 拉直路徑（去掉多餘的轉折點），預設 true */
  smooth?: boolean;
}

/** 二元堆積（A* 的開放清單） */
class MinHeap {
  private items: number[] = [];
  constructor(private readonly score: Float32Array) {}
  get size(): number {
    return this.items.length;
  }
  push(i: number): void {
    const a = this.items;
    a.push(i);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.score[a[p]] <= this.score[a[k]]) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1,
          r = l + 1;
        let m = k;
        if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l;
        if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;

/**
 * 導航網格（格子版）：把地面切成格子，標記哪些格子可以走，用 A* 找路。
 * 可以手動標記，也可以用 bakeFromPhysics 從物理碰撞體自動產生。
 */
export class NavGrid {
  /** 格子大小（公尺） */
  readonly cellSize: number;
  /** 欄數（x 方向） */
  readonly cols: number;
  /** 列數（z 方向） */
  readonly rows: number;
  /** 範圍的最小角（x、z） */
  readonly min: { x: number; z: number };
  /** 網格的高度（找到的路徑點用這個 y） */
  readonly y: number;
  /** 1 = 可走，0 = 擋住 */
  readonly walkable: Uint8Array;
  /** 每格的額外成本（例如泥地較慢），預設 1 */
  readonly cost: Float32Array;

  /**
   * @param options 範圍（min、max）、格子大小、地面高度
   */
  constructor(options: NavGridOptions) {
    this.cellSize = options.cellSize ?? 0.5;
    this.min = { ...options.min };
    this.y = options.y ?? 0;
    this.cols = Math.max(1, Math.ceil((options.max.x - options.min.x) / this.cellSize));
    this.rows = Math.max(1, Math.ceil((options.max.z - options.min.z) / this.cellSize));
    this.walkable = new Uint8Array(this.cols * this.rows).fill(1);
    this.cost = new Float32Array(this.cols * this.rows).fill(1);
  }

  // ───────── 座標換算 ─────────

  /**
   * 世界座標所在的格子，超出範圍回傳 null
   * @param p 世界座標（只用 x、z）
   */
  cellOf(p: { x: number; z: number }): { col: number; row: number } | null {
    const col = Math.floor((p.x - this.min.x) / this.cellSize);
    const row = Math.floor((p.z - this.min.z) / this.cellSize);
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return null;
    return { col, row };
  }

  /**
   * 格子中心的世界座標
   * @param col 第幾欄
   * @param row 第幾列
   * @param out 存放結果的向量（省略時建立新的）
   */
  cellCenter(col: number, row: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.min.x + (col + 0.5) * this.cellSize, this.y, this.min.z + (row + 0.5) * this.cellSize);
  }

  /**
   * 這個位置能不能走
   * @param p 世界座標（只用 x、z）
   */
  isWalkable(p: { x: number; z: number }): boolean {
    const c = this.cellOf(p);
    return c !== null && this.walkable[c.row * this.cols + c.col] === 1;
  }

  // ───────── 標記 ─────────

  /**
   * 設定格子能不能走
   * @param col 第幾欄
   * @param row 第幾列
   * @param walkable true 可走、false 擋住
   */
  setWalkable(col: number, row: number, walkable: boolean): void {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return;
    this.walkable[row * this.cols + col] = walkable ? 1 : 0;
  }

  /**
   * 把一個矩形範圍（世界座標）標記為擋住或可走
   * @param minX 範圍的最小 X（世界座標）
   * @param minZ 範圍的最小 Z
   * @param maxX 範圍的最大 X
   * @param maxZ 範圍的最大 Z
   * @param walkable true 可走、false 擋住
   */
  setArea(minX: number, minZ: number, maxX: number, maxZ: number, walkable: boolean): void {
    const a = this.cellOf({ x: Math.max(minX, this.min.x), z: Math.max(minZ, this.min.z) });
    const b = this.cellOf({
      x: Math.min(maxX, this.min.x + this.cols * this.cellSize - 1e-6),
      z: Math.min(maxZ, this.min.z + this.rows * this.cellSize - 1e-6),
    });
    if (!a || !b) return;
    for (let r = a.row; r <= b.row; r++) for (let c = a.col; c <= b.col; c++) this.setWalkable(c, r, walkable);
  }

  /**
   * 把障礙物往外擴大 cells 格：替角色的身體寬度預留空間，避免轉彎時切進牆角。
   * （bakeFromPhysics 已經用 agentRadius 處理過，通常只有手動標記時需要）
   * @param cells 往外擴大幾格
   */
  inflate(cells: number): void {
    if (cells <= 0) return;
    const source = this.walkable.slice();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (source[r * this.cols + c]) continue;
        for (let dr = -cells; dr <= cells; dr++) {
          for (let dc = -cells; dc <= cells; dc++) this.setWalkable(c + dc, r + dr, false);
        }
      }
    }
  }

  /**
   * 從物理世界產生：每個格子中心放一顆半徑為 agentRadius 的球，碰到固定障礙物就標記為擋住。
   * 地板不會被算進去，只要 probeY 高於地板 agentRadius 以上。
   * @param physics 物理世界
   * @param world ECS 世界
   * @param options 角色半徑、探測高度、忽略的實體
   */
  bakeFromPhysics(physics: Physics, world: World, options: BakeOptions): void {
    physics.flush();
    const ignore =
      options.ignore ??
      ((e: Entity) => {
        const type = world.get(e, RigidBody)?.type;
        return type === 'dynamic' || type === 'kinematic';
      });
    const p = new THREE.Vector3();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.cellCenter(c, r, p);
        p.y = options.probeY;
        const blocked = physics.overlapSphere(p, options.agentRadius).some((e) => !ignore(this.ownerOf(world, e)));
        this.walkable[r * this.cols + c] = blocked ? 0 : 1;
      }
    }
  }

  // ───────── 尋路 ─────────

  /**
   * A* 尋路。起點或終點在障礙物裡時，會改用最近的可走格子。
   * 找不到路回傳 null。
   * @param start 起點（世界座標）
   * @param goal 終點（世界座標）
   * @param options 是否走斜線、是否平滑路線
   */
  findPath(start: Vec3, goal: Vec3, options: PathOptions = {}): THREE.Vector3[] | null {
    const diagonal = options.diagonal ?? true;
    const s = this.nearestWalkable(start);
    const g = this.nearestWalkable(goal);
    if (s === null || g === null) return null;
    const n = this.cols * this.rows;
    const startIndex = s.row * this.cols + s.col;
    const goalIndex = g.row * this.cols + g.col;

    const gScore = new Float32Array(n).fill(Infinity);
    const fScore = new Float32Array(n).fill(Infinity);
    const cameFrom = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heuristic = (i: number) => {
      const dx = Math.abs((i % this.cols) - g.col);
      const dz = Math.abs(Math.floor(i / this.cols) - g.row);
      // 八方向距離（octile）
      return diagonal ? Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz) : dx + dz;
    };
    gScore[startIndex] = 0;
    fScore[startIndex] = heuristic(startIndex);
    const open = new MinHeap(fScore);
    open.push(startIndex);

    const dirs = diagonal
      ? [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]
      : [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];

    while (open.size > 0) {
      const current = open.pop();
      if (current === goalIndex) return this.buildPath(cameFrom, current, start, goal, options.smooth ?? true);
      if (closed[current]) continue;
      closed[current] = 1;
      const cc = current % this.cols;
      const cr = Math.floor(current / this.cols);
      for (const [dc, dr] of dirs) {
        const nc = cc + dc,
          nr = cr + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const ni = nr * this.cols + nc;
        if (!this.walkable[ni] || closed[ni]) continue;
        // 斜走時不能切過障礙物的角
        if (dc !== 0 && dr !== 0 && (!this.walkable[cr * this.cols + nc] || !this.walkable[nr * this.cols + cc]))
          continue;
        const step = (dc !== 0 && dr !== 0 ? SQRT2 : 1) * this.cost[ni];
        const tentative = gScore[current] + step;
        if (tentative < gScore[ni]) {
          cameFrom[ni] = current;
          gScore[ni] = tentative;
          fScore[ni] = tentative + heuristic(ni);
          open.push(ni);
        }
      }
    }
    return null;
  }

  /**
   * 兩點之間是否全部可走（直線經過的每個格子）
   * @param a 起點（世界座標，只用 x、z）
   * @param b 終點（世界座標，只用 x、z）
   */
  lineOfSight(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(dist / (this.cellSize * 0.25)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isWalkable({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) return false;
    }
    return true;
  }

  /** 除錯用：把擋住的格子畫成紅色方塊 */
  createDebugMesh(): THREE.InstancedMesh {
    const blocked: number[] = [];
    for (let i = 0; i < this.walkable.length; i++) if (!this.walkable[i]) blocked.push(i);
    const size = this.cellSize * 0.9;
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(size, 0.02, size),
      new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.45, depthWrite: false }),
      Math.max(1, blocked.length),
    );
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    blocked.forEach((index, k) => {
      this.cellCenter(index % this.cols, Math.floor(index / this.cols), p);
      mesh.setMatrixAt(k, m.makeTranslation(p.x, p.y + 0.01, p.z));
    });
    mesh.count = blocked.length;
    return mesh;
  }

  // ───────── 內部 ─────────

  private nearestWalkable(p: Vec3): { col: number; row: number } | null {
    const clamped = {
      x: THREE.MathUtils.clamp(p.x, this.min.x, this.min.x + this.cols * this.cellSize - 1e-6),
      z: THREE.MathUtils.clamp(p.z, this.min.z, this.min.z + this.rows * this.cellSize - 1e-6),
    };
    const c = this.cellOf(clamped)!;
    if (this.walkable[c.row * this.cols + c.col]) return c;
    // 由近到遠一圈一圈找
    const maxRing = Math.max(this.cols, this.rows);
    for (let ring = 1; ring < maxRing; ring++) {
      let best: { col: number; row: number } | null = null;
      let bestD = Infinity;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
          const col = c.col + dc,
            row = c.row + dr;
          if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) continue;
          if (!this.walkable[row * this.cols + col]) continue;
          const d = dc * dc + dr * dr;
          if (d < bestD) {
            bestD = d;
            best = { col, row };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  private buildPath(cameFrom: Int32Array, end: number, start: Vec3, goal: Vec3, smooth: boolean): THREE.Vector3[] {
    const cells: number[] = [];
    for (let i = end; i !== -1; i = cameFrom[i]) cells.push(i);
    cells.reverse();
    const points = cells.map((i) => this.cellCenter(i % this.cols, Math.floor(i / this.cols)));
    // 首尾換成實際的起點、終點（若可走）
    if (this.isWalkable(start)) points[0] = new THREE.Vector3(start.x, this.y, start.z);
    if (this.isWalkable(goal)) points[points.length - 1] = new THREE.Vector3(goal.x, this.y, goal.z);
    if (!smooth || points.length <= 2) return points;
    // 拉直：從目前點直接看得到的最遠點
    const result = [points[0]];
    let anchor = 0;
    while (anchor < points.length - 1) {
      let next = points.length - 1;
      while (next > anchor + 1 && !this.lineOfSight(points[anchor], points[next])) next--;
      result.push(points[next]);
      anchor = next;
    }
    return result;
  }

  /** 組合碰撞形狀的子實體：以有剛體的祖先判斷（沒有剛體就是自己） */
  private ownerOf(world: World, e: Entity): Entity {
    const hierarchy = world.getResource(HierarchyKey);
    for (let cur: Entity | null = e; cur !== null; cur = hierarchy?.parentOf(cur) ?? null) {
      if (world.has(cur, RigidBody)) return cur;
      if (!hierarchy) break;
    }
    return e;
  }
}
