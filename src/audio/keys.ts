/**
 * audio 模組的資源鍵（不包含其他程式：其他模組只需要鍵時引用這裡，不會連帶包含整個模組）。
 */
import { defineResource } from '../ecs/Resource';
import type { AudioManager } from './AudioManager';

/** 讓系統取得音效管理：world.requireResource(AudioKey) */
export const AudioKey = defineResource<AudioManager>('Audio');
