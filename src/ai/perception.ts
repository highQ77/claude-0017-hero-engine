import * as THREE from 'three';
import type { Entity, World } from '../ecs';
import { PhysicsKey } from '../physics/keys';
import { HierarchyKey, Transform } from '../scene';

/** 視線判斷的設定（距離、視角、眼睛高度） */
export interface SightOptions {
  /** 視距 */
  range?: number;
  /** 視野角度（度），360 為全方位 */
  fov?: number;
  /** 眼睛高度（相對於實體原點） */
  eyeHeight?: number;
  /** 用物理射線檢查是否被擋住（需要 PhysicsPlugin），預設 true */
  occlusion?: boolean;
}

const _eye = new THREE.Vector3();
const _target = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * viewer 看不看得到 target：距離、視野角度，以及中間有沒有障礙物。
 * 前方為 viewer 的 -Z 方向。
 */
export function canSee(world: World, viewer: Entity, target: Entity, options: SightOptions = {}): boolean {
  const vt = world.get(viewer, Transform);
  const tt = world.get(target, Transform);
  if (!vt || !tt) return false;
  const range = options.range ?? 10;
  const fov = options.fov ?? 120;

  vt.worldMatrix.decompose(_eye, _q, _s);
  _eye.y += options.eyeHeight ?? 0;
  _target.setFromMatrixPosition(tt.worldMatrix);
  const toTarget = _target.clone().sub(_eye);
  const dist = toTarget.length();
  if (dist > range) return false;
  if (dist < 1e-6) return true;

  if (fov < 360) {
    _forward.set(0, 0, -1).applyQuaternion(_q);
    const angle = THREE.MathUtils.radToDeg(_forward.angleTo(toTarget));
    if (angle > fov / 2) return false;
  }

  const physics = options.occlusion === false ? undefined : world.getResource(PhysicsKey);
  if (!physics) return true;
  const hit = physics.raycast(_eye, toTarget, dist, { exclude: viewer });
  if (!hit) return true;
  // 打到的是目標本身（或目標的子實體）就算看得到
  const hierarchy = world.getResource(HierarchyKey);
  for (let e: Entity | null = hit.entity; e !== null; e = hierarchy?.parentOf(e) ?? null) {
    if (e === target) return true;
    if (!hierarchy) break;
  }
  return hit.distance >= dist - 0.05;
}

/** 兩個實體之間的距離（世界座標） */
export function distanceBetween(world: World, a: Entity, b: Entity): number {
  const ta = world.get(a, Transform);
  const tb = world.get(b, Transform);
  if (!ta || !tb) return Infinity;
  return _eye.setFromMatrixPosition(ta.worldMatrix).distanceTo(_target.setFromMatrixPosition(tb.worldMatrix));
}
