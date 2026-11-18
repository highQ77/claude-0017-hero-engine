import { collisionGroups } from './components';
import { initRapier } from './PhysicsPlugin';
export { RigidBody, Collider } from './components';
export { rigidBodyCodec, colliderCodec } from './sceneCodecs';
export type { RigidBodyData, RigidBodyType, ColliderData, ColliderShape } from './components';
export { Physics } from './Physics';
export type { Vec3, CollisionEvent, RaycastOptions, PhysicsHit, RapierModule } from './Physics';
export { PhysicsPlugin, PhysicsKey, PHYSICS_STEP_PRIORITY, PHYSICS_WRITE_PRIORITY } from './PhysicsPlugin';
export type { PhysicsOptions } from './PhysicsPlugin';

// ───────── 小工具函式（依用途分類）─────────

/** 碰撞：碰撞群組 */
export const collision = {
  /** 碰撞群組：collision.groups([自己屬於的群組], [會碰撞的群組]) */
  groups: collisionGroups,
} as const;

/** 載入：物理引擎、排版引擎、內建字型（外掛建立時會自動載入）（physics 模組的部分；總入口 hero.load 有全部） */
export const load = {
  /** 載入物理引擎 Rapier（PhysicsPlugin.create() 會自動載入） */
  rapier: initRapier,
} as const;
