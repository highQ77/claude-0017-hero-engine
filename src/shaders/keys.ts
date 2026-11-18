/**
 * shaders 模組的資源鍵（不包含其他程式：其他模組只需要鍵時引用這裡，不會連帶包含整個模組）。
 */
import { defineResource } from '../ecs/Resource';
import type { ShaderLibrary } from './ShaderLibrary';

/** 讓系統取得著色器庫：world.requireResource(ShadersKey) */
export const ShadersKey = defineResource<ShaderLibrary>('Shaders');
