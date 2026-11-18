/**
 * ui3d 模組的資源鍵（不包含其他程式：其他模組只需要鍵時引用這裡，不會連帶包含整個模組）。
 */
import { defineResource } from '../ecs/Resource';
import type { UI3DPlugin } from './UI3DPlugin';

/** 讓系統與腳本取得：world.requireResource(UI3DKey) */
export const UI3DKey = defineResource<UI3DPlugin>('UI3D');
