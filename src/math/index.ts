/**
 * 數學：向量、四元數、尤拉角、矩陣、顏色等。
 *
 *   import { Vector3, Quaternion, MathUtils } from '@engine/math';
 *   const v = new Vector3(0, 1, 0);
 *
 * 這些就是 three.js 的類別（直接轉出，沒有包一層）：沒有轉換成本，instanceof 照常成立，
 * 引擎各處（Transform 的 position、rotation…）用的也是同一個類別，three.js 的文件照樣適用。
 * 遊戲程式從這裡引用，就不需要 import three。
 */
export {
  Box2,
  Box3,
  Color,
  Cylindrical,
  Euler,
  Line3,
  MathUtils,
  Matrix3,
  Matrix4,
  Plane,
  Quaternion,
  Ray,
  Sphere,
  Spherical,
  Triangle,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
export type { ColorRepresentation, EulerOrder } from 'three';
export { Random } from './Random';
export { Path } from './Path';
export type { CurvePathOptions, PathPoint } from './Path';
