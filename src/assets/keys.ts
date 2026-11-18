/**
 * assets 模組的資源鍵（不包含其他程式：其他模組只需要鍵時引用這裡，不會連帶包含整個模組）。
 */
import { defineResource } from '../ecs/Resource';
import type { AssetManager } from './AssetManager';

/** 讓系統取得資源管理：world.requireResource(AssetsKey) */
export const AssetsKey = defineResource<AssetManager>('Assets');
