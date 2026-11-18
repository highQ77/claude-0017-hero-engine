/**
 * input 模組的資源鍵（不包含其他程式：其他模組只需要鍵時引用這裡，不會連帶包含整個模組）。
 */
import { defineResource } from '../ecs/Resource';
import type { Input } from './Input';

/** 讓系統取得輸入狀態：world.requireResource(InputKey) */
export const InputKey = defineResource<Input>('Input');
