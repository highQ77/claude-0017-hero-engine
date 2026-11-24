/**
 * scene 模組的資源鍵（不包含其他程式：其他模組只需要鍵時引用這裡，不會連帶包含整個模組）。
 */
import { defineResource } from '../ecs/Resource';
import type { BufferGeometry } from 'three';
import type { Entity } from '../ecs/Entity';
import type { Hierarchy } from './Hierarchy';
import type { SceneCodecs } from './SceneFile';

/** 讓系統取得父子關係：world.requireResource(HierarchyKey) */
export const HierarchyKey = defineResource<Hierarchy>('Hierarchy');

/**
 * 實體的網格幾何（繪製外掛安裝時提供）。
 * 物理用它從網格建立 convexHull、trimesh 碰撞體，不需要知道繪製的細節。temporary 為 true 時用完要 dispose()。
 */
export interface MeshGeometrySource {
  /**
   * 實體的網格幾何（沒有網格時是 null）
   * @param entity 實體
   */
  geometryOf(entity: Entity): { geometry: BufferGeometry; temporary: boolean } | null;
}

/** 讓其他模組取得實體的網格幾何（繪製外掛提供） */
export const MeshGeometryKey = defineResource<MeshGeometrySource>('MeshGeometry');

/** 場景檔的元件存讀規則（場景外掛安裝時建立；其他外掛用 register() 登記自己的元件） */
export const SceneCodecsKey = defineResource<SceneCodecs>('SceneCodecs');
