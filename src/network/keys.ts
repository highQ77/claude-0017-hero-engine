/**
 * network 模組的資源鍵（不包含其他程式：其他模組只需要鍵時引用這裡，不會連帶包含整個模組）。
 */
import { defineResource } from '../ecs/Resource';
import type { NetworkClient } from './NetworkClient';
import type { NetworkPlugin } from './NetworkPlugin';

/** 讓系統與腳本取得：world.requireResource(NetworkKey)、world.requireResource(ReplicationKey) */
export const NetworkKey = defineResource<NetworkClient>('Network');

/** 讓系統取得多人同步外掛：world.requireResource(ReplicationKey) */
export const ReplicationKey = defineResource<NetworkPlugin>('Replication');
