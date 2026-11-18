import type { BufferGeometry } from 'three';
import { defineComponent } from '../ecs/Component';

/** 剛體種類：dynamic（受力與重力影響）、fixed（不動）、kinematic（由程式移動，會推開其他物體） */
export type RigidBodyType = 'dynamic' | 'fixed' | 'kinematic';

/**
 * 剛體：讓實體受物理模擬控制。
 * - dynamic：受重力與碰撞影響，位置由物理寫回 Transform
 * - fixed：不會動（地板、牆壁），改 Transform 可以搬移它
 * - kinematic：由你改 Transform 來移動（電梯、移動平台），會推開其他物體
 *
 * 剛體實體最好沒有父節點；有父節點時會自動換算座標。
 * 建立後才修改的欄位：只有 type 以外的數值會即時套用。
 */
export interface RigidBodyData {
  /** 剛體種類（預設 dynamic） */
  type: RigidBodyType;
  /** 移動的阻力（越大越快停下） */
  linearDamping: number;
  /** 旋轉的阻力 */
  angularDamping: number;
  /** 重力倍率（0 為不受重力） */
  gravityScale: number;
  /** 連續碰撞偵測：高速物體（子彈）避免穿牆 */
  ccd: boolean;
  /** 可旋轉的軸，例如角色只允許繞 Y 軸轉：{ x: false, y: true, z: false } */
  rotations: { x: boolean; y: boolean; z: boolean };
  /** 靜止一段時間後休眠以節省效能 */
  canSleep: boolean;
}

/** 剛體元件：讓實體受物理模擬（需要 Collider） */
export const RigidBody = defineComponent<RigidBodyData>('RigidBody', () => ({
  type: 'dynamic',
  linearDamping: 0,
  angularDamping: 0.05,
  gravityScale: 1,
  ccd: false,
  rotations: { x: true, y: true, z: true },
  canSleep: true,
}));

/** 碰撞形狀：方塊、球、膠囊、圓柱、圓錐、凸包（用網格）、三角網格（用網格，只能是固定的） */
export type ColliderShape = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'cone' | 'convexHull' | 'trimesh';

/**
 * 碰撞形狀。掛在剛體實體上，或剛體的子孫實體上（組合形狀）。
 * 沒有任何剛體時，就是一個固定不動的碰撞體。
 *
 * 大小會乘上實體的世界縮放（在建立時計算）。
 * 形狀相關欄位建立後修改不會生效；摩擦、彈性、密度、感應器可以即時修改。
 */
export interface ColliderData {
  /** 碰撞形狀（預設 box） */
  shape: ColliderShape;
  /** box 的半邊長 */
  halfExtents: { x: number; y: number; z: number };
  /** sphere、capsule、cylinder、cone 的半徑 */
  radius: number;
  /** capsule、cylinder、cone 沿 Y 軸的半高 */
  halfHeight: number;
  /** convexHull、trimesh 用的幾何；null 時使用同一實體 MeshRenderer 的幾何（需要安裝 RenderPlugin） */
  geometry: BufferGeometry | null;
  /** 相對於實體的位移 */
  offset: { x: number; y: number; z: number };
  /** 摩擦力 */
  friction: number;
  /** 彈性 0~1 */
  restitution: number;
  /** 密度（決定質量） */
  density: number;
  /** 感應器：只偵測重疊、不產生碰撞（例如觸發區域、拾取物） */
  sensor: boolean;
  /** 碰撞群組，用 collisionGroups() 產生；預設與所有物體碰撞 */
  groups: number;
  /** 是否回報碰撞事件 */
  events: boolean;
}

/** 碰撞體元件：沒有剛體時是固定的碰撞體（地板、牆） */
export const Collider = defineComponent<ColliderData>('Collider', () => ({
  shape: 'box',
  halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
  radius: 0.5,
  halfHeight: 0.5,
  geometry: null,
  offset: { x: 0, y: 0, z: 0 },
  friction: 0.5,
  restitution: 0,
  density: 1,
  sensor: false,
  groups: 0xffffffff,
  events: true,
}));

/**
 * 產生碰撞群組（0~15 號）。
 * @param memberships 自己屬於哪些群組
 * @param filters 會和哪些群組碰撞
 * @example
 * const PLAYER = 0, ENEMY = 1, BULLET = 2;
 * collision.groups([BULLET], [ENEMY]); // 子彈只打敵人
 */
export function collisionGroups(memberships: number[], filters: number[]): number {
  const mask = (list: number[]) =>
    list.reduce((m, g) => {
      if (g < 0 || g > 15) throw new Error(`碰撞群組必須是 0~15：${g}`);
      return m | (1 << g);
    }, 0);
  return ((mask(memberships) << 16) | mask(filters)) >>> 0;
}
