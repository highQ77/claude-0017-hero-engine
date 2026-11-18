/**
 * 碰撞體在編輯時的樣子（線框），以及「符合網格大小」。
 * 線框在實體的區域座標裡（含 offset），畫的時候乘上實體的世界矩陣（世界縮放也會套用，和物理一樣）。
 */
import * as THREE from 'three';
import type { ColliderData } from '../../physics';

type ShapeData = Pick<ColliderData, 'shape' | 'halfExtents' | 'radius' | 'halfHeight' | 'offset'>;

const SEGMENTS = 32;

/** 圓：在 XZ 平面（axis 'y'）、XY 平面（'z'）或 YZ 平面（'x'），中心 y */
function circle(out: number[], r: number, axis: 'x' | 'y' | 'z', y = 0): void {
  for (let i = 0; i < SEGMENTS; i++) {
    const a0 = (i / SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / SEGMENTS) * Math.PI * 2;
    for (const a of [a0, a1]) {
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r;
      if (axis === 'y') out.push(c, y, s);
      else if (axis === 'z') out.push(c, s + y, 0);
      else out.push(0, c + y, s);
    }
  }
}

/** 半圓弧（膠囊的頭尾）：在 plane 平面上、朝 +Y（dir 1）或 -Y（dir -1） */
function arc(out: number[], r: number, plane: 'xy' | 'zy', y: number, dir: 1 | -1): void {
  const n = SEGMENTS / 2;
  for (let i = 0; i < n; i++) {
    for (const a of [(i / n) * Math.PI, ((i + 1) / n) * Math.PI]) {
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r * dir + y;
      if (plane === 'xy') out.push(c, s, 0);
      else out.push(0, s, c);
    }
  }
}

/** 基本形狀的線段頂點（LineSegments 用，每兩個點一段）；convexHull、trimesh 回傳 null（用網格的邊） */
export function colliderLinePoints(c: ShapeData): number[] | null {
  const out: number[] = [];
  const { radius: r, halfHeight: h } = c;
  switch (c.shape) {
    case 'box': {
      const { x, y, z } = c.halfExtents;
      const corners = [
        [-x, -y, -z],
        [x, -y, -z],
        [x, y, -z],
        [-x, y, -z],
        [-x, -y, z],
        [x, -y, z],
        [x, y, z],
        [-x, y, z],
      ];
      const edges = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
      for (const i of edges) out.push(...corners[i]);
      break;
    }
    case 'sphere':
      circle(out, r, 'x');
      circle(out, r, 'y');
      circle(out, r, 'z');
      break;
    case 'capsule':
      circle(out, r, 'y', h);
      circle(out, r, 'y', -h);
      for (const [px, pz] of [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
      ])
        out.push(px, -h, pz, px, h, pz);
      arc(out, r, 'xy', h, 1);
      arc(out, r, 'xy', -h, -1);
      arc(out, r, 'zy', h, 1);
      arc(out, r, 'zy', -h, -1);
      break;
    case 'cylinder':
      circle(out, r, 'y', h);
      circle(out, r, 'y', -h);
      for (const [px, pz] of [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
      ])
        out.push(px, -h, pz, px, h, pz);
      break;
    case 'cone':
      circle(out, r, 'y', -h);
      for (const [px, pz] of [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
      ])
        out.push(px, -h, pz, 0, h, 0);
      break;
    default:
      return null;
  }
  const { x, y, z } = c.offset;
  if (x || y || z)
    for (let i = 0; i < out.length; i += 3) {
      out[i] += x;
      out[i + 1] += y;
      out[i + 2] += z;
    }
  return out;
}

/** 碰撞體的線框幾何；convexHull、trimesh 用網格幾何的邊（沒有網格時回傳 null） */
export function colliderGeometry(c: ShapeData, mesh: THREE.BufferGeometry | null): THREE.BufferGeometry | null {
  const pts = colliderLinePoints(c);
  if (pts) return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return mesh ? new THREE.EdgesGeometry(mesh, 30) : null;
}

/**
 * 依網格範圍（實體的區域座標）算出碰撞體的大小與位移（場景檔的寫法）。
 * 方塊：半邊長；球：半徑取最大的半邊；膠囊、圓柱、圓錐：半徑取 X、Z 較大的半邊，半高取 Y（膠囊扣掉頭尾）。
 */
export function fitCollider(shape: ColliderData['shape'], box: THREE.Box3): Record<string, unknown> {
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const center = box.getCenter(new THREE.Vector3());
  const round = (n: number) => Math.round(n * 1000) / 1000 + 0;
  const out: Record<string, unknown> = {};
  if (shape === 'box') out.halfExtents = [round(size.x), round(size.y), round(size.z)];
  else if (shape === 'sphere') out.radius = round(Math.max(size.x, size.y, size.z));
  else if (shape === 'capsule' || shape === 'cylinder' || shape === 'cone') {
    const r = Math.max(size.x, size.z);
    out.radius = round(r);
    out.halfHeight = round(shape === 'capsule' ? Math.max(0.001, size.y - r) : size.y);
  } else return out; // convexHull、trimesh 直接用網格
  if (center.lengthSq() > 1e-8) out.offset = [round(center.x), round(center.y), round(center.z)];
  return out;
}
