// 只使用 three.js 的數學類別（純計算，不涉及繪製）
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Entity, System, World } from '../ecs';
import { defineComponent, type ComponentType } from '../ecs/Component';
import { HierarchyKey, Parent } from './Hierarchy';

/** 位置、旋轉、縮放 */
export interface TransformData {
  /** 區域座標（相對父節點） */
  position: Vector3;
  /** 旋轉（四元數） */
  rotation: Quaternion;
  /** 縮放 */
  scale: Vector3;
  /** 由 TransformSystem 計算，請勿手動修改 */
  localMatrix: Matrix4;
  /** 由 TransformSystem 計算的世界矩陣，請勿手動修改 */
  worldMatrix: Matrix4;
}

const TransformType = defineComponent<TransformData>('Transform', () => ({
  position: new Vector3(),
  rotation: new Quaternion(),
  scale: new Vector3(1, 1, 1),
  localMatrix: new Matrix4(),
  worldMatrix: new Matrix4(),
}));

/** Transform 元件類型，加上 at() */
export interface TransformComponent extends ComponentType<TransformData> {
  /**
   * 指定位置的 Transform，給 world.spawn 用：world.spawn(Transform.at(0, 1, 0), MeshRenderer.with(…))
   * 也可以給 [x, y, z]：Transform.at([0, 1, 0])
   * @param x X，或 [x, y, z]
   * @param y Y
   * @param z Z
   */
  at(
    x: number | readonly number[],
    y?: number,
    z?: number,
  ): readonly [ComponentType<TransformData>, Partial<TransformData>];
}

/** 位置、旋轉、縮放元件（有父節點時是相對於父節點）；Transform.at(x, y, z) 指定位置 */
export const Transform: TransformComponent = Object.freeze({
  ...TransformType,
  with: TransformType.with,
  at(x: number | readonly number[], y = 0, z = 0) {
    const p = typeof x === 'number' ? new Vector3(x, y, z) : new Vector3(x[0] ?? 0, x[1] ?? 0, x[2] ?? 0);
    return TransformType.with({ position: p });
  },
});

const _euler = new Euler();
const _quat = new Quaternion();

/**
 * 在自己的座標上旋轉（累加）：angles 是 [x, y, z] 弧度，依 X、Y、Z 順序。每幀轉一點用這個：
 *   math.rotate(t, [0, speed * time.delta, 0])
 * @param t Transform 的資料
 * @param angles [x, y, z] 弧度
 */
export function rotate(t: TransformData, angles: readonly number[]): TransformData {
  t.rotation.multiply(_quat.setFromEuler(_euler.set(angles[0] ?? 0, angles[1] ?? 0, angles[2] ?? 0, 'XYZ')));
  return t;
}

/**
 * 設定旋轉（取代原本的）：angles 是 [x, y, z] 弧度，依 X、Y、Z 順序
 * @param t Transform 的資料
 * @param angles [x, y, z] 弧度
 */
export function setRotation(t: TransformData, angles: readonly number[]): TransformData {
  t.rotation.setFromEuler(_euler.set(angles[0] ?? 0, angles[1] ?? 0, angles[2] ?? 0, 'XYZ'));
  return t;
}

/**
 * 取得世界座標位置
 * @param t Transform 的資料
 * @param out 存放結果的向量（省略時建立新的）
 */
export function getWorldPosition(t: TransformData, out = new Vector3()): Vector3 {
  return out.setFromMatrixPosition(t.worldMatrix);
}

const _lookAtMatrix = new Matrix4();
const _defaultUp = new Vector3(0, 1, 0);

/**
 * 讓 -Z 方向朝向目標（攝影機、平行光、聚光燈的朝向慣例）。
 * target 與 position 都以父節點座標計算；沒有父節點時即世界座標。
 * @param t Transform 的資料
 * @param target 要看向的位置
 * @param up 上方（預設 +Y）
 */
export function lookAt(t: TransformData, target: Vector3, up: Vector3 = _defaultUp): void {
  _lookAtMatrix.lookAt(t.position, target, up);
  t.rotation.setFromRotationMatrix(_lookAtMatrix);
}

/**
 * 依父子層級計算所有世界矩陣。
 * 通常由 TransformSystem 自動執行；若在同一幀內需要最新的世界座標，可以手動呼叫。
 * @param world ECS 世界
 */
export function updateTransforms(world: World): void {
  const hierarchy = world.getResource(HierarchyKey);

  const isRoot = (e: Entity): boolean => {
    const p = world.get(e, Parent);
    return !p || !world.isAlive(p.entity) || !world.has(p.entity, Transform);
  };

  const visit = (e: Entity, parentWorld: Matrix4 | null): void => {
    const t = world.get(e, Transform)!;
    t.localMatrix.compose(t.position, t.rotation, t.scale);
    if (parentWorld) t.worldMatrix.multiplyMatrices(parentWorld, t.localMatrix);
    else t.worldMatrix.copy(t.localMatrix);
    if (!hierarchy) return;
    for (const child of hierarchy.childrenOf(e)) {
      if (world.has(child, Transform)) visit(child, t.worldMatrix);
    }
  };

  for (const e of world.query([Transform]).entities) {
    if (!hierarchy || isRoot(e)) visit(e, null);
  }
}

/** 在 lateUpdate 的最後執行，讓使用者的 lateUpdate（例如攝影機跟隨）先跑完 */
export const TRANSFORM_PRIORITY = 1000;

/** 更新世界矩陣的系統（場景外掛會自動加入） */
export const transformSystem: System = {
  name: 'transform',
  phase: 'lateUpdate',
  priority: TRANSFORM_PRIORITY,
  run: (world) => updateTransforms(world),
};
