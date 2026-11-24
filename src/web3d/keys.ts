/**
 * web3d 模組的資源鍵（不包含其他程式：其他模組只需要鍵時引用這裡，不會連帶包含整個模組）。
 */
import { defineResource } from '../ecs/Resource';
import type { Web3DPlugin } from './Web3DPlugin';

/** 讓系統與腳本取得：world.requireResource(Web3DKey) */
export const Web3DKey = defineResource<Web3DPlugin>('Web3D');
