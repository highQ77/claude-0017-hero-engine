/**
 * physics 模組的資源鍵（不包含其他程式：其他模組只需要鍵時引用這裡，不會連帶包含整個模組）。
 */
import { defineResource } from '../ecs/Resource';
import type { Physics } from './Physics';

/** 讓系統取得物理世界：world.requireResource(PhysicsKey) */
export const PhysicsKey = defineResource<Physics>('Physics');
