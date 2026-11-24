/**
 * 攝影機跟隨與晃動（RenderPlugin 安裝時啟用）。
 *
 * 跟隨：攝影機加上 CameraFollow，平滑地跟著目標、看著目標，可以限制範圍。
 *
 *   world.add(camera, CameraFollow, { target: player, offset: new Vector3(0, 4, 7) });
 *   world.add(camera, CameraFollow, { target: player, offsetSpace: 'target' });   // 跟在背後（跟著目標轉向）
 *
 * 晃動：shakeCamera(world, camera, 0.6) —— 受傷、爆炸、落地時畫面震一下（0~1，可以疊加，會自己慢慢停下來）。
 * 晃動只加在繪製用的攝影機上（這一幀），不會改到攝影機的 Transform：
 * 不會越晃越偏，也不會和其他控制攝影機的程式（OrbitControl、自己寫的系統）互相干擾。
 */
import * as THREE from 'three';
import { defineComponent } from '../ecs/Component';
import type { Entity } from '../ecs/Entity';
import type { World } from '../ecs/World';
import { Parent } from '../scene/Hierarchy';
import { Transform } from '../scene/Transform';

/** CameraFollow 的資料 */
export interface CameraFollowData {
  /** 跟隨的實體（null 時不動） */
  target: Entity | null;
  /** 攝影機相對目標的位置（預設在後上方 [0, 3, 6]） */
  offset: THREE.Vector3;
  /** offset 的座標：'world' 固定方向（俯視、橫向捲軸）；'target' 跟著目標的左右轉向（第三人稱，跟在背後） */
  offsetSpace: 'world' | 'target';
  /** 位置的平滑時間（秒）：越大越慢、越柔和；0 代表立刻跟上（預設 0.25） */
  smoothTime: number;
  /** 一直看著目標（預設 true；false 時攝影機的朝向不變） */
  lookAt: boolean;
  /** 看向目標的哪裡（相對目標的位置，例如頭部 [0, 1.5, 0]；預設 [0, 0.5, 0]） */
  lookOffset: THREE.Vector3;
  /** 轉向的平滑時間（秒；0 代表立刻，預設 0.1） */
  rotationSmoothTime: number;
  /** 攝影機位置的範圍（例如不要拍到地圖外面）；null 代表不限制 */
  bounds: { min: THREE.Vector3; max: THREE.Vector3 } | null;
  /** 暫停跟隨 */
  enabled: boolean;
}

/** 攝影機跟隨目標 */
export const CameraFollow = defineComponent<CameraFollowData>('CameraFollow', () => ({
  target: null,
  offset: new THREE.Vector3(0, 3, 6),
  offsetSpace: 'world',
  smoothTime: 0.25,
  lookAt: true,
  lookOffset: new THREE.Vector3(0, 0.5, 0),
  rotationSmoothTime: 0.1,
  bounds: null,
  enabled: true,
}));

/** CameraShake 的資料 */
export interface CameraShakeData {
  /** 目前的晃動量（0~1；shakeCamera() 會增加它，之後每秒減少 decay） */
  trauma: number;
  /** 每秒減少多少（預設 1.5：最大的晃動約 0.7 秒停下來） */
  decay: number;
  /** 最大的位移（公尺，預設 0.25） */
  maxOffset: number;
  /** 最大的旋轉（度，預設 2.5） */
  maxAngle: number;
  /** 晃動的快慢（預設 18） */
  frequency: number;
}

/** 攝影機晃動（通常用 shakeCamera() 加上，不用自己加） */
export const CameraShake = defineComponent<CameraShakeData>('CameraShake', () => ({
  trauma: 0,
  decay: 1.5,
  maxOffset: 0.25,
  maxAngle: 2.5,
  frequency: 18,
}));

/**
 * 讓攝影機晃一下：amount 0~1（0.2 輕微、0.5 爆炸、1 很大）。可以疊加（最多到 1），會自己慢慢停下來。
 * 攝影機還沒有 CameraShake 時自動加上；options 可以改晃動的設定。
 * @param world ECS 世界
 * @param camera 攝影機的實體
 * @param amount 晃動強度 0~1（0.2 輕微、0.5 爆炸、1 很大）
 * @param options 衰減速度、最大位移與角度、晃動頻率
 */
export function shakeCamera(world: World, camera: Entity, amount = 0.5, options: Partial<CameraShakeData> = {}): void {
  const s = world.get(camera, CameraShake) ?? world.add(camera, CameraShake);
  Object.assign(s, options);
  s.trauma = Math.min(1, s.trauma + Math.max(0, amount));
}

// ───────── 系統 ─────────

const _local = new THREE.Matrix4();
const _parent = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _parentRotation = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _target = new THREE.Vector3();
const _look = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _euler = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);

/** 實體現在的世界矩陣（沿著父節點現算，不用等 Transform 系統更新：跟隨不會慢一幀） */
function freshWorldMatrix(world: World, e: Entity, out: THREE.Matrix4): boolean {
  const t = world.get(e, Transform);
  if (!t) return false;
  out.compose(t.position, t.rotation, t.scale);
  for (let p = world.get(e, Parent)?.entity, depth = 0; p !== undefined && depth < 64; depth++) {
    const pt = world.get(p, Transform);
    if (!pt) break;
    out.premultiply(_local.compose(pt.position, pt.rotation, pt.scale));
    p = world.get(p, Parent)?.entity;
  }
  return true;
}

/** 平滑係數：每幀往目標靠近多少（和幀率無關） */
const smoothing = (dt: number, time: number) => (time > 0 ? 1 - Math.exp(-dt / time) : 1);

/** 平滑的雜訊（-1~1）：幾個不同頻率的 sin 疊在一起 */
const wobble = (t: number, seed: number) =>
  Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.13 + seed * 2.9) * 0.2;

/**
 * 攝影機跟隨與晃動的控制器（RenderPlugin 建立，render.snapCamera 用它）。
 * @example
 * render.snapCamera(camera); // 傳送之後：下一幀直接跳到跟隨位置
 */
export class CameraRig {
  /** 已經就位的攝影機（第一幀直接放到位置，不會從原點飛過去） */
  private readonly placed = new Set<Entity>();
  private elapsed = 0;
  private readonly offs: (() => void)[];

  /**
   * @param world ECS 世界
   */
  constructor(private readonly world: World) {
    this.offs = [world.onDestroy((e) => this.placed.delete(e))];
  }

  /**
   * 讓攝影機下一幀直接跳到跟隨位置（例如傳送、切換場景之後）
   * @param camera 攝影機的實體
   */
  snap(camera: Entity): void {
    this.placed.delete(camera);
  }

  /**
   * 跟隨（lateUpdate，在 Transform 系統之前）
   * @param dt 這一幀的時間（秒）
   */
  updateFollow(dt: number): void {
    this.world.query([Transform, CameraFollow]).each((cam, t, f) => {
      if (!f.enabled || f.target === null || !this.world.isAlive(f.target)) return;
      if (!freshWorldMatrix(this.world, f.target, _m)) return;
      _m.decompose(_target, _q, _s);
      // 位置：目標 + offset（'target' 時只跟著目標的左右轉向，不跟著上下傾斜）
      _desired.copy(f.offset);
      if (f.offsetSpace === 'target') {
        _v.set(0, 0, 1).applyQuaternion(_q);
        const yaw = Math.atan2(_v.x, _v.z);
        _desired.applyAxisAngle(_yAxis, yaw);
      }
      _desired.add(_target);
      if (f.bounds) _desired.clamp(f.bounds.min, f.bounds.max);
      // 攝影機目前的世界位置
      const parent = this.world.get(cam, Parent)?.entity;
      const hasParent = parent !== undefined && freshWorldMatrix(this.world, parent, _parent);
      _v.copy(t.position);
      if (hasParent) _v.applyMatrix4(_parent);
      const first = !this.placed.has(cam);
      _v.lerp(_desired, first ? 1 : smoothing(dt, f.smoothTime));
      // 看著目標
      let rotation: THREE.Quaternion | null = null;
      if (f.lookAt) {
        _look.copy(f.lookOffset).add(_target);
        if (_look.distanceToSquared(_v) > 1e-10) {
          _m.lookAt(_v, _look, _up);
          rotation = _q.setFromRotationMatrix(_m);
        }
      }
      // 寫回 Transform（有父節點時換成相對父節點）
      if (hasParent) {
        t.position.copy(_v).applyMatrix4(_local.copy(_parent).invert());
        if (rotation) {
          _parent.decompose(_look, _parentRotation, _s);
          rotation.premultiply(_parentRotation.invert());
        }
      } else t.position.copy(_v);
      if (rotation) {
        if (first) t.rotation.copy(rotation);
        else t.rotation.slerp(rotation, smoothing(dt, f.rotationSmoothTime));
      }
      this.placed.add(cam);
    });
  }

  /**
   * 晃動（render 階段：攝影機從 Transform 同步之後、繪製之前），只改繪製用的攝影機物件。
   * getCamera：實體 → three.js 攝影機
   * @param dt 這一幀的時間（秒）
   * @param getCamera 實體 → three.js 攝影機
   */
  updateShake(dt: number, getCamera: (e: Entity) => THREE.Object3D | undefined): void {
    this.elapsed += dt;
    this.world.query([CameraShake]).each((cam, s) => {
      if (s.trauma <= 0) return;
      s.trauma = Math.max(0, s.trauma - s.decay * dt);
      const obj = getCamera(cam);
      if (!obj) return;
      const k = s.trauma * s.trauma; // 平方：小的晃動很輕、大的晃動很明顯
      const t = this.elapsed * s.frequency;
      const seed = (cam % 997) * 1.37;
      const deg = (s.maxAngle * Math.PI) / 180;
      _v.set(wobble(t, seed) * s.maxOffset * k, wobble(t, seed + 11) * s.maxOffset * k, 0);
      _euler.set(
        wobble(t, seed + 23) * deg * k * 0.5,
        wobble(t, seed + 37) * deg * k * 0.5,
        wobble(t, seed + 51) * deg * k,
      );
      _q.setFromEuler(_euler);
      // 在攝影機自己的座標裡位移、旋轉（畫面上下左右晃、微微傾斜）
      obj.matrix.multiply(_local.compose(_v, _q, _s.set(1, 1, 1)));
      obj.matrixWorldNeedsUpdate = true;
    });
  }

  /** 停止（RenderPlugin 移除時呼叫） */
  dispose(): void {
    for (const off of this.offs) off();
    this.placed.clear();
  }
}
