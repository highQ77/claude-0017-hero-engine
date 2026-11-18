/**
 * postfx 模組的資源鍵（不包含其他程式：其他模組只需要鍵時引用這裡，不會連帶包含整個模組）。
 */
import { defineResource } from '../ecs/Resource';
import type { PostProcessingPlugin } from './PostProcessingPlugin';

/** 讓系統取得後製設定：world.requireResource(PostFxKey).settings.bloom.strength = 1 */
export const PostFxKey = defineResource<PostProcessingPlugin>('PostFx');
