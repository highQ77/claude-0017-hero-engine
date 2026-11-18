/**
 * render 模組的資源鍵（不包含其他程式：其他模組只需要鍵時引用這裡，不會連帶包含整個模組）。
 */
import { defineResource } from '../ecs/Resource';
import type { RenderPlugin } from './RenderPlugin';

/** 讓系統取得繪製外掛：world.requireResource(RenderKey) */
export const RenderKey = defineResource<RenderPlugin>('Render');
