import { defineComponent, defineTag } from './Component';
import { defineResource } from './World';
import { defineEvent } from './Events';
import { entityGeneration, entityIndex } from './Entity';
export { NULL_ENTITY } from './Entity';
export type { Entity } from './Entity';
export { ComponentStore } from './Component';
export type { ComponentType } from './Component';
export { Query } from './Query';
export type { ComponentValues, QueryOptions } from './Query';
export { World } from './World';
export type { ResourceKey, ComponentInit } from './World';
export { EcsPlugin } from './System';
export { EventBus } from './Events';
export type { EventType, EventOptions } from './Events';
export type { System } from './System';

// ───────── 小工具函式（依用途分類）─────────

/** 定義：元件、標籤、資源、套件（ecs 模組的部分；總入口 hero.define 有全部） */
export const define = {
  /** 定義元件：define.component('Velocity', () => ({ x: 0, y: 0, z: 0 })) */
  component: defineComponent,
  /** 定義標籤元件（沒有資料，只用來分類，例如 Player、Enemy） */
  tag: defineTag,
  /** 定義資源的鍵：world.setResource(鍵, 值)、world.getResource(鍵) */
  resource: defineResource,
  /** 定義事件：define.event<{ value: number }>('CoinCollected')；world.events.emit／on */
  event: defineEvent,
} as const;

/** 實體編號的組成（索引、世代） */
export const entityId = {
  /** 實體編號的索引部分 */
  index: entityIndex,
  /** 實體編號的世代部分（同一個索引被重複使用時會增加） */
  generation: entityGeneration,
} as const;
