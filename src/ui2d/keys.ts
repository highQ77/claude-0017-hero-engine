/**
 * ui2d 模組的資源鍵（不包含其他程式：其他模組只需要鍵時引用這裡，不會連帶包含整個模組）。
 */
import { defineResource } from '../ecs/Resource';
import type { UI2D } from './UI2D';

/** 讓系統與腳本取得介面：world.requireResource(UIKey) */
export const UIKey = defineResource<UI2D>('UI2D');
