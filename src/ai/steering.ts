import * as THREE from 'three';
import type { Vec3 } from '../physics/Physics';

/**
 * 轉向行為（Craig Reynolds）：每個函式回傳「想要施加的力」，可以加權相加。
 * 預設只在 XZ 平面上運作（地面角色）。
 */

const _v = new THREE.Vector3();

/**
 * 往目標全速前進
 * @param position 自己的位置
 * @param velocity 自己目前的速度
 * @param target 要前往的位置
 * @param maxSpeed 最高速度（公尺／秒）
 * @param out 存放結果的向量（省略時建立新的）
 */
export function seek(
  position: Vec3,
  velocity: Vec3,
  target: Vec3,
  maxSpeed: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  out.set(target.x - position.x, target.y - position.y, target.z - position.z);
  const len = out.length();
  if (len < 1e-6) return out.set(0, 0, 0);
  out.multiplyScalar(maxSpeed / len);
  return out.sub(_v.set(velocity.x, velocity.y, velocity.z));
}

/**
 * 遠離目標
 * @param position 自己的位置
 * @param velocity 自己目前的速度
 * @param threat 要遠離的位置
 * @param maxSpeed 最高速度（公尺／秒）
 * @param out 存放結果的向量（省略時建立新的）
 */
export function flee(
  position: Vec3,
  velocity: Vec3,
  threat: Vec3,
  maxSpeed: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  seek(position, velocity, threat, maxSpeed, out);
  // seek 的期望速度反向：-(desired) - velocity
  _v.set(velocity.x, velocity.y, velocity.z);
  return out.add(_v).negate().sub(_v);
}

/**
 * 往目標前進，進入 slowRadius 後逐漸減速，停在目標上
 * @param position 自己的位置
 * @param velocity 自己目前的速度
 * @param target 要抵達的位置
 * @param maxSpeed 最高速度（公尺／秒）
 * @param slowRadius 離目標多近開始減速
 * @param out 存放結果的向量（省略時建立新的）
 */
export function arrive(
  position: Vec3,
  velocity: Vec3,
  target: Vec3,
  maxSpeed: number,
  slowRadius: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  out.set(target.x - position.x, target.y - position.y, target.z - position.z);
  const dist = out.length();
  if (dist < 1e-6) return out.set(-velocity.x, -velocity.y, -velocity.z);
  const speed = dist < slowRadius ? maxSpeed * (dist / slowRadius) : maxSpeed;
  out.multiplyScalar(speed / dist);
  return out.sub(_v.set(velocity.x, velocity.y, velocity.z));
}

/**
 * 預測目標未來位置並追上
 * @param position 自己的位置
 * @param velocity 自己目前的速度
 * @param targetPos 目標的位置
 * @param targetVel 目標的速度（用來預測位置）
 * @param maxSpeed 最高速度（公尺／秒）
 * @param out 存放結果的向量（省略時建立新的）
 */
export function pursue(
  position: Vec3,
  velocity: Vec3,
  targetPos: Vec3,
  targetVel: Vec3,
  maxSpeed: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const dist = Math.hypot(targetPos.x - position.x, targetPos.y - position.y, targetPos.z - position.z);
  const t = Math.min(dist / Math.max(maxSpeed, 1e-6), 2);
  const future = {
    x: targetPos.x + targetVel.x * t,
    y: targetPos.y + targetVel.y * t,
    z: targetPos.z + targetVel.z * t,
  };
  return seek(position, velocity, future, maxSpeed, out);
}

/**
 * 預測威脅未來位置並躲開
 * @param position 自己的位置
 * @param velocity 自己目前的速度
 * @param threatPos 威脅的位置
 * @param threatVel 威脅的速度（用來預測位置）
 * @param maxSpeed 最高速度（公尺／秒）
 * @param out 存放結果的向量（省略時建立新的）
 */
export function evade(
  position: Vec3,
  velocity: Vec3,
  threatPos: Vec3,
  threatVel: Vec3,
  maxSpeed: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const dist = Math.hypot(threatPos.x - position.x, threatPos.y - position.y, threatPos.z - position.z);
  const t = Math.min(dist / Math.max(maxSpeed, 1e-6), 2);
  const future = {
    x: threatPos.x + threatVel.x * t,
    y: threatPos.y + threatVel.y * t,
    z: threatPos.z + threatVel.z * t,
  };
  return flee(position, velocity, future, maxSpeed, out);
}

/**
 * 隨意遊走：在前方的圓上隨機偏移目標點，產生自然的漫步。
 * state.angle 會被更新，請每個角色各自保存。
 * @param position 自己的位置
 * @param velocity 自己目前的速度
 * @param state 每個角色各自保存的遊走狀態（會被更新）
 * @param maxSpeed 最高速度（公尺／秒）
 * @param dt 這一幀的時間（秒）
 * @param options 圓的距離、半徑、隨機程度
 * @param out 存放結果的向量（省略時建立新的）
 */
export function wander(
  position: Vec3,
  velocity: Vec3,
  state: {
    /** 目前在圓上的角度（弧度）：每個角色各自保存，wander 會更新它 */
    angle: number;
  },
  maxSpeed: number,
  dt: number,
  options: {
    /** 圓心在前方多遠，預設 2 */
    distance?: number;
    /** 圓的半徑：越大轉彎越大，預設 1 */
    radius?: number;
    /** 每秒隨機改變角度的幅度（弧度）：越大越常改變方向，預設 3 */
    jitter?: number;
  } = {},
  out = new THREE.Vector3(),
): THREE.Vector3 {
  const distance = options.distance ?? 2;
  const radius = options.radius ?? 1;
  const jitter = options.jitter ?? 3;
  state.angle += (Math.random() * 2 - 1) * jitter * dt;
  const heading = Math.hypot(velocity.x, velocity.z) > 1e-3 ? Math.atan2(velocity.z, velocity.x) : state.angle;
  const cx = position.x + Math.cos(heading) * distance;
  const cz = position.z + Math.sin(heading) * distance;
  const target = { x: cx + Math.cos(state.angle) * radius, y: position.y, z: cz + Math.sin(state.angle) * radius };
  return seek(position, velocity, target, maxSpeed, out);
}

/**
 * 與鄰居保持距離：越近推力越大
 * @param position 自己的位置
 * @param neighbors 鄰居的位置
 * @param radius 保持多遠的距離
 * @param maxSpeed 最高速度（公尺／秒）
 * @param out 存放結果的向量（省略時建立新的）
 */
export function separation(
  position: Vec3,
  neighbors: readonly Vec3[],
  radius: number,
  maxSpeed: number,
  out = new THREE.Vector3(),
): THREE.Vector3 {
  out.set(0, 0, 0);
  for (const n of neighbors) {
    _v.set(position.x - n.x, position.y - n.y, position.z - n.z);
    const d = _v.length();
    if (d < 1e-6 || d > radius) continue;
    out.addScaledVector(_v, (radius - d) / (radius * d)); // 方向 × 接近程度
  }
  return out.multiplyScalar(maxSpeed);
}

/**
 * 把向量長度限制在 max 以內
 * @param v 要限制的向量（會被修改）
 * @param max 最大長度
 */
export function truncate(v: THREE.Vector3, max: number): THREE.Vector3 {
  const len = v.length();
  if (len > max) v.multiplyScalar(max / len);
  return v;
}
