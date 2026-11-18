/**
 * 路徑曲線：穿過幾個點的平滑曲線（巡邏路線、攝影機軌道、移動平台、子彈弧線）。
 *
 *   const path = new Path([[0, 0, 0], [4, 1, 2], [8, 0, 0]], { closed: false });
 *   path.pointAt(0.5);          // 走到一半的位置（依實際距離，速度均勻）
 *   path.tangentAt(0.5);        // 那裡的前進方向（單位向量）
 *   path.length;                // 全長
 *   path.sample(32);            // 均勻取 32 個點（畫線、除錯用）
 *
 * t 從 0（起點）到 1（終點）；closed 時 1 會回到起點。用 three.js 的 CatmullRomCurve3。
 */
import { CatmullRomCurve3, Vector3 } from 'three';

/** 一個點：Vector3、[x, y, z] 或 { x, y, z } */
export type PathPoint = Vector3 | readonly [number, number, number] | { x: number; y: number; z: number };

/** Path 的設定 */
export interface CurvePathOptions {
  /** 頭尾相連（繞一圈） */
  closed?: boolean;
  /**
   * 彎曲程度：0 很鬆（大圓弧）、1 很緊（接近折線）。
   * 不給時用 centripetal（向心）曲線：轉彎自然、不會繞出多餘的圈或超出端點，適合大部分的路徑。
   */
  tension?: number;
}

const toVector = (p: PathPoint): Vector3 =>
  p instanceof Vector3
    ? p.clone()
    : Array.isArray(p)
      ? new Vector3(p[0], p[1], p[2])
      : new Vector3((p as { x: number }).x, (p as { y: number }).y, (p as { z: number }).z);

/**
 * 穿過幾個點的平滑曲線：pointAt(t) 位置、tangentAt(t) 方向、length 全長（t 從 0 到 1，依實際距離）。
 * @example
 * const path = new Path([[0, 0, 0], [4, 1, 2], [8, 0, 0]]);
 * path.pointAt(0.5);
 */
export class Path {
  private readonly curve: CatmullRomCurve3;

  constructor(points: readonly PathPoint[], options: CurvePathOptions = {}) {
    if (points.length < 2) throw new Error('Path：至少要兩個點');
    const vs = points.map(toVector);
    const closed = options.closed ?? false;
    this.curve =
      options.tension === undefined
        ? new CatmullRomCurve3(vs, closed, 'centripetal')
        : new CatmullRomCurve3(vs, closed, 'catmullrom', options.tension);
    this.curve.arcLengthDivisions = Math.max(200, vs.length * 40); // 依距離取點更準（點很多時也均勻）
  }

  /** 曲線經過的點（複本） */
  get points(): Vector3[] {
    return this.curve.points.map((p) => p.clone());
  }

  /** 頭尾相連 */
  get closed(): boolean {
    return this.curve.closed;
  }

  /** 全長 */
  get length(): number {
    return this.curve.getLength();
  }

  /** 位置：t 從 0 到 1，依實際距離（速度均勻）；給 target 時寫進它（不建立新物件） */
  pointAt(t: number, target = new Vector3()): Vector3 {
    return this.curve.getPointAt(this.wrap(t), target);
  }

  /** 前進方向（單位向量）：t 從 0 到 1 */
  tangentAt(t: number, target = new Vector3()): Vector3 {
    return this.curve.getTangentAt(this.wrap(t), target);
  }

  /** 走了 distance 的位置（超過全長時：closed 繞回來，否則停在終點） */
  pointAtDistance(distance: number, target = new Vector3()): Vector3 {
    return this.pointAt(distance / Math.max(this.length, 1e-9), target);
  }

  /** 均勻取 count 個點（包含頭尾） */
  sample(count: number): Vector3[] {
    return this.curve.getSpacedPoints(Math.max(1, count - 1));
  }

  /** closed：t 超出 0~1 時繞回來；不是 closed：夾在 0~1 */
  private wrap(t: number): number {
    if (this.curve.closed) return ((t % 1) + 1) % 1;
    return Math.min(1, Math.max(0, t));
  }
}
