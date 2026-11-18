import type { BufferGeometry, Material, Object3D, Texture } from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * 釋放物件樹中所有幾何、材質、貼圖的 GPU 資源（共用的只會釋放一次）。
 */
export function disposeObject3D(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();

  root.traverse((obj) => {
    const mesh = obj as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) {
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
    }
  });

  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value && (value as Texture).isTexture) textures.add(value as Texture);
    }
    material.dispose();
  }
  for (const g of geometries) g.dispose();
  for (const t of textures) t.dispose();
}

/**
 * 複製模型以放進場景：幾何、材質與原始資源共用，骨架動畫的骨骼會正確重新綁定。
 * 複製品不需要個別釋放，原始資源參考計數歸零時一併釋放。
 */
export function instantiate<T extends Object3D>(source: T): T {
  return skeletonClone(source) as T;
}
