/** 物理元件的場景檔存讀規則：RigidBody、Collider（PhysicsPlugin 安裝時登記） */
import { plainCodec, type ComponentCodec } from '../scene/SceneFile';
import { Collider, RigidBody } from './components';

/** RigidBody：{ type, gravityScale, linearDamping, angularDamping, ccd, canSleep, rotations: [x, y, z]（可旋轉的軸） } */
export const rigidBodyCodec = plainCodec(RigidBody, {
  choices: { type: ['dynamic', 'fixed', 'kinematic'] },
  triples: ['rotations'],
});

/**
 * Collider：{ shape, halfExtents: [x, y, z], radius, halfHeight, offset: [x, y, z], friction, restitution, density, sensor, groups, events }。
 * convexHull、trimesh 用同一實體的網格（程式給的 geometry 不能存）。
 */
export const colliderCodec = plainCodec(Collider, {
  choices: { shape: ['box', 'sphere', 'capsule', 'cylinder', 'cone', 'convexHull', 'trimesh'] },
  triples: ['halfExtents', 'offset'],
  skip: ['geometry'],
});

/** 物理模組提供的所有存讀規則 */
export const physicsCodecs: readonly ComponentCodec<never>[] = [
  rigidBodyCodec,
  colliderCodec,
] as unknown as ComponentCodec<never>[];
