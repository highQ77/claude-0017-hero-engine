/**
 * 地表射線：從某一點沿著某個方向，找到打在地形或船身上的位置與表面方向。
 * 給幽靈的影子用（沙漠和船都是烘焙光影的材質，不會接收即時陰影，所以影子要自己畫在表面上）。
 *
 * - 地形：載入時把地形的頂點整理成高度圖（地形是規則的格子），之後查高度只要幾次內插，很便宜
 * - 船（其他物件）：載入時把三角形轉成世界座標存起來；射線先檢查外框，穿過外框才逐一檢查三角形
 */
import { Box3, Ray, Vector3 } from '@engine/math';
import type { Mesh } from '@engine/render';

/** 打到的位置與表面法線（朝向射線來的那一側） */
export interface SurfaceHit {
  point: Vector3;
  normal: Vector3;
}

/** 從 origin 沿 dir（單位向量）找表面；打到時寫進 out 並回傳 true */
export type CastRay = (origin: Vector3, dir: Vector3, out: SurfaceHit) => boolean;

// ───────── 地形高度圖 ─────────

interface HeightMap {
  x0: number;
  z0: number;
  step: number;
  nx: number;
  nz: number;
  heights: Float32Array;
}

const v = new Vector3();

function buildHeightMap(terrain: Mesh): HeightMap {
  terrain.updateWorldMatrix(true, false);
  const pos = terrain.geometry.attributes.position;
  const xs = new Set<number>();
  const zs = new Set<number>();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(terrain.matrixWorld);
    xs.add(Math.round(v.x * 1000) / 1000);
    zs.add(Math.round(v.z * 1000) / 1000);
  }
  const x0 = Math.min(...xs);
  const z0 = Math.min(...zs);
  const nx = xs.size;
  const nz = zs.size;
  const step = (Math.max(...xs) - x0) / (nx - 1);
  const heights = new Float32Array(nx * nz).fill(Number.NaN);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(terrain.matrixWorld);
    const ix = Math.round((v.x - x0) / step);
    const iz = Math.round((v.z - z0) / step);
    heights[iz * nx + ix] = Math.max(heights[iz * nx + ix] || -Infinity, v.y);
  }
  return { x0, z0, step, nx, nz, heights };
}

/** 地形在 (x, z) 的高度（雙線性內插）；超出地形時回傳 NaN */
function heightAt(m: HeightMap, x: number, z: number): number {
  const fx = (x - m.x0) / m.step;
  const fz = (z - m.z0) / m.step;
  if (fx < 0 || fz < 0 || fx > m.nx - 1 || fz > m.nz - 1) return Number.NaN;
  const ix = Math.min(Math.floor(fx), m.nx - 2);
  const iz = Math.min(Math.floor(fz), m.nz - 2);
  const tx = fx - ix;
  const tz = fz - iz;
  const h = (i: number, j: number) => m.heights[(iz + j) * m.nx + ix + i];
  return (h(0, 0) * (1 - tx) + h(1, 0) * tx) * (1 - tz) + (h(0, 1) * (1 - tx) + h(1, 1) * tx) * tz;
}

// ───────── 建立 ─────────

/** 用地形與其他物件（例如船身、船帆）建立射線查詢；物件是靜止的，載入後只整理一次 */
export function createSurface(terrain: Mesh, obstacles: Mesh[]): CastRay {
  const map = buildHeightMap(terrain);

  // 其他物件：三角形轉成世界座標
  const tris: number[] = [];
  const box = new Box3();
  for (const mesh of obstacles) {
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.attributes.position;
    const index = mesh.geometry.index;
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      tris.push(v.x, v.y, v.z);
      box.expandByPoint(v);
    }
  }
  const triangles = new Float32Array(tris);

  const ray = new Ray();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const hit = new Vector3();
  const best = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();

  return (origin, dir, out) => {
    // 地形：沿著射線反覆修正（先用正下方的高度估計，再用估計點的高度重算，幾次就收斂）
    let terrainT = Number.POSITIVE_INFINITY;
    if (dir.y < -1e-3) {
      let h = heightAt(map, origin.x, origin.z);
      let t = 0;
      for (let i = 0; i < 6 && !Number.isNaN(h); i++) {
        t = Math.max(0, (origin.y - h) / -dir.y);
        h = heightAt(map, origin.x + dir.x * t, origin.z + dir.z * t);
      }
      if (!Number.isNaN(h)) terrainT = t;
    }

    // 船：穿過外框才逐一檢查三角形，留下最近的
    let objectT = Number.POSITIVE_INFINITY;
    ray.set(origin, dir);
    if (ray.intersectsBox(box)) {
      for (let i = 0; i < triangles.length; i += 9) {
        a.fromArray(triangles, i);
        b.fromArray(triangles, i + 3);
        c.fromArray(triangles, i + 6);
        if (!ray.intersectTriangle(a, b, c, false, hit)) continue;
        const t = hit.distanceTo(origin);
        if (t >= objectT || t >= terrainT) continue;
        objectT = t;
        best.copy(hit);
        out.normal.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
      }
    }

    if (objectT < terrainT) {
      out.point.copy(best);
    } else if (Number.isFinite(terrainT)) {
      out.point.copy(origin).addScaledVector(dir, terrainT);
      // 地形法線：左右、前後的高度差
      const d = map.step;
      const { x, z } = out.point;
      const dx = heightAt(map, x + d, z) - heightAt(map, x - d, z);
      const dz = heightAt(map, x, z + d) - heightAt(map, x, z - d);
      out.normal.set(-dx, 2 * d, -dz).normalize();
      if (Number.isNaN(out.normal.x)) out.normal.set(0, 1, 0);
    } else {
      return false;
    }
    if (out.normal.dot(dir) > 0) out.normal.negate(); // 朝向射線來的那一側
    return true;
  };
}
