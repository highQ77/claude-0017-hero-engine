import * as THREE from 'three';
import type { Entity, World } from '../ecs';
import { Transform } from '../scene';
import { ParticleEmitter, type ParticleEmitterData, type Range } from './components';
import { createParticleGeometry, createParticleMaterial } from './ParticleMaterial';

/** 每個發射器的粒子資料（結構化陣列，避免為每個粒子建立物件） */
interface Pool {
  max: number;
  count: number;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  age: Float32Array;
  life: Float32Array;
  size: Float32Array;
  rot: Float32Array;
  spin: Float32Array;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  attributes: ReturnType<typeof createParticleGeometry>['attributes'];
  /** 還沒發射完的小數部分 */
  carry: number;
  elapsed: number;
  colorCache: {
    a: THREE.ColorRepresentation | null;
    b: THREE.ColorRepresentation | null;
    ca: THREE.Color;
    cb: THREE.Color;
  };
}

const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _color = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function rand(r: Range): number {
  return typeof r === 'number' ? r : r[0] + Math.random() * (r[1] - r[0]);
}

/** 在以 dir 為中心、半角 spread 的圓錐內取一個隨機方向 */
function randomInCone(dir: THREE.Vector3, spread: number, out: THREE.Vector3): THREE.Vector3 {
  const cosMax = Math.cos(Math.min(spread, Math.PI));
  const cos = cosMax + Math.random() * (1 - cosMax);
  const sin = Math.sqrt(1 - cos * cos);
  const phi = Math.random() * Math.PI * 2;
  // 以 dir 為 Z 軸建立正交基底
  _a.copy(Math.abs(dir.y) < 0.99 ? UP : _b.set(1, 0, 0))
    .cross(dir)
    .normalize();
  _b.copy(dir).cross(_a);
  return out
    .copy(dir)
    .multiplyScalar(cos)
    .addScaledVector(_a, Math.cos(phi) * sin)
    .addScaledVector(_b, Math.sin(phi) * sin);
}

/**
 * 粒子模擬：每幀發射、移動、淘汰粒子，並寫入繪製用的屬性。
 * 粒子用 three.js 的實例化繪製，每個發射器只需要一次繪製呼叫。
 */
export class ParticleController {
  private readonly pools = new Map<Entity, Pool>();
  private readonly off: () => void;

  constructor(
    private readonly world: World,
    private readonly scene: THREE.Scene,
  ) {
    this.off = world.onRemove(ParticleEmitter, (e) => this.release(e));
  }

  /** 全部發射器的存活粒子數 */
  get totalParticles(): number {
    let n = 0;
    for (const p of this.pools.values()) n += p.count;
    return n;
  }

  /** 立即清除某個發射器的所有粒子 */
  clear(e: Entity): void {
    const pool = this.pools.get(e);
    if (pool) pool.count = 0;
  }

  /** 推進模擬（受時間縮放影響） */
  update(dt: number): void {
    this.world.query([ParticleEmitter, Transform]).each((e, em, t) => {
      let pool = this.pools.get(e);
      if (pool && pool.max !== em.maxParticles) {
        this.release(e);
        pool = undefined;
      }
      if (!pool) pool = this.create(e, em);

      t.worldMatrix.decompose(_p, _q, _s);
      // 先推進既有粒子，再發射新的（新粒子從年齡 0、發射點開始）
      this.simulate(pool, em, dt);
      this.emit(pool, em, dt);
      this.fill(pool, em);
      em.aliveCount = pool.count;

      // 一次性特效結束 → 銷毀實體
      const finished = !em.loop && pool.elapsed >= em.duration && em.burstCount === 0;
      if (em.autoDestroy && finished && pool.count === 0) this.world.defer(() => this.world.destroy(e));
    });
  }

  /** 繪製前：local 空間的發射器跟隨實體位置 */
  syncMatrices(): void {
    for (const [e, pool] of this.pools) {
      const em = this.world.get(e, ParticleEmitter);
      const t = this.world.get(e, Transform);
      if (!em || !t) continue;
      if (em.space === 'local') pool.mesh.matrix.copy(t.worldMatrix);
      else pool.mesh.matrix.identity();
      pool.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  /** 移除所有粒子 */
  dispose(): void {
    this.off();
    for (const e of [...this.pools.keys()]) this.release(e);
  }

  // ───────── 內部 ─────────

  private create(e: Entity, em: ParticleEmitterData): Pool {
    const max = Math.max(1, Math.floor(em.maxParticles));
    const { geometry, attributes } = createParticleGeometry(max);
    const material = createParticleMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // 粒子範圍會變動，不做視錐剔除
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 10; // 透明物件之後再畫
    mesh.userData.entity = e;
    this.scene.add(mesh);
    const f = () => new Float32Array(max);
    const pool: Pool = {
      max,
      count: 0,
      px: f(),
      py: f(),
      pz: f(),
      vx: f(),
      vy: f(),
      vz: f(),
      age: f(),
      life: f(),
      size: f(),
      rot: f(),
      spin: f(),
      mesh,
      material,
      attributes,
      carry: 0,
      elapsed: 0,
      colorCache: { a: null, b: null, ca: new THREE.Color(), cb: new THREE.Color() },
    };
    this.pools.set(e, pool);
    return pool;
  }

  private emit(pool: Pool, em: ParticleEmitterData, dt: number): void {
    let n = 0;
    if (em.burstCount > 0) {
      n += em.burstCount;
      em.burstCount = 0;
    }
    if (em.playing) {
      // 不循環時只計算 duration 之內的那段時間，避免浮點誤差多發射一個
      const activeDt = em.loop ? dt : Math.max(0, Math.min(dt, em.duration - pool.elapsed));
      if (activeDt > 0 && em.rate > 0) {
        pool.carry += em.rate * activeDt;
        const whole = Math.floor(pool.carry);
        pool.carry -= whole;
        n += whole;
      }
      pool.elapsed += dt;
      if (em.loop && Number.isFinite(em.duration) && em.duration > 0 && pool.elapsed >= em.duration) {
        pool.elapsed %= em.duration;
      }
    }
    n = Math.min(n, pool.max - pool.count); // 滿了就不再發射
    if (n <= 0) return;

    const world = em.space === 'world';
    _dir.set(em.direction.x, em.direction.y, em.direction.z);
    if (_dir.lengthSq() === 0) _dir.set(0, 1, 0);
    _dir.normalize();

    for (let k = 0; k < n; k++) {
      const i = pool.count++;
      // 位置：在發射形狀內取點（實體的區域座標）
      switch (em.shape) {
        case 'sphere': {
          randomInCone(UP, Math.PI, _v).multiplyScalar(em.radius * Math.cbrt(Math.random()));
          break;
        }
        case 'circle': {
          const r = em.radius * Math.sqrt(Math.random());
          const a = Math.random() * Math.PI * 2;
          _v.set(Math.cos(a) * r, 0, Math.sin(a) * r);
          break;
        }
        case 'box':
          _v.set(
            (Math.random() * 2 - 1) * em.halfExtents.x,
            (Math.random() * 2 - 1) * em.halfExtents.y,
            (Math.random() * 2 - 1) * em.halfExtents.z,
          );
          break;
        default:
          _v.set(0, 0, 0);
      }
      if (world) _v.multiply(_s).applyQuaternion(_q).add(_p); // 轉成世界座標
      pool.px[i] = _v.x;
      pool.py[i] = _v.y;
      pool.pz[i] = _v.z;

      // 速度：圓錐內的隨機方向
      randomInCone(_dir, em.spread, _v).multiplyScalar(rand(em.speed));
      if (world) _v.applyQuaternion(_q);
      pool.vx[i] = _v.x;
      pool.vy[i] = _v.y;
      pool.vz[i] = _v.z;

      pool.age[i] = 0;
      pool.life[i] = Math.max(0.001, rand(em.lifetime));
      pool.size[i] = rand(em.size);
      pool.rot[i] = rand(em.rotation);
      pool.spin[i] = rand(em.angularVelocity);
    }
  }

  private simulate(pool: Pool, em: ParticleEmitterData, dt: number): void {
    const ax = em.acceleration.x * dt,
      ay = em.acceleration.y * dt,
      az = em.acceleration.z * dt;
    const damp = em.drag > 0 ? Math.exp(-em.drag * dt) : 1;
    let i = 0;
    while (i < pool.count) {
      pool.age[i] += dt;
      if (pool.age[i] >= pool.life[i]) {
        // 死亡：把最後一個搬過來補位，保持陣列連續
        const last = --pool.count;
        if (i !== last) {
          pool.px[i] = pool.px[last];
          pool.py[i] = pool.py[last];
          pool.pz[i] = pool.pz[last];
          pool.vx[i] = pool.vx[last];
          pool.vy[i] = pool.vy[last];
          pool.vz[i] = pool.vz[last];
          pool.age[i] = pool.age[last];
          pool.life[i] = pool.life[last];
          pool.size[i] = pool.size[last];
          pool.rot[i] = pool.rot[last];
          pool.spin[i] = pool.spin[last];
        }
        continue; // 補過來的這個還沒處理
      }
      pool.vx[i] = (pool.vx[i] + ax) * damp;
      pool.vy[i] = (pool.vy[i] + ay) * damp;
      pool.vz[i] = (pool.vz[i] + az) * damp;
      pool.px[i] += pool.vx[i] * dt;
      pool.py[i] += pool.vy[i] * dt;
      pool.pz[i] += pool.vz[i] * dt;
      pool.rot[i] += pool.spin[i] * dt;
      i++;
    }
  }

  /** 依壽命進度計算大小、顏色、透明度，寫入繪製屬性 */
  private fill(pool: Pool, em: ParticleEmitterData): void {
    const cache = pool.colorCache;
    if (cache.a !== em.color) {
      cache.ca.set(em.color);
      cache.a = em.color;
    }
    if (cache.b !== em.colorEnd) {
      cache.cb.set(em.colorEnd);
      cache.b = em.colorEnd;
    }

    const m = pool.material;
    m.uniforms.map.value = em.texture ?? m.uniforms.map.value;
    m.uniforms.stretch.value = em.stretch;
    const blending = em.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (m.blending !== blending) {
      m.blending = blending;
      m.needsUpdate = true;
    }

    const { offset, velocity, color, sizeRotation } = pool.attributes;
    const o = offset.array as Float32Array,
      v = velocity.array as Float32Array;
    const c = color.array as Float32Array,
      sr = sizeRotation.array as Float32Array;
    for (let i = 0; i < pool.count; i++) {
      const t = pool.age[i] / pool.life[i];
      o[i * 3] = pool.px[i];
      o[i * 3 + 1] = pool.py[i];
      o[i * 3 + 2] = pool.pz[i];
      v[i * 3] = pool.vx[i];
      v[i * 3 + 1] = pool.vy[i];
      v[i * 3 + 2] = pool.vz[i];
      _color.copy(cache.ca).lerp(cache.cb, t);
      let alpha = em.opacity + (em.opacityEnd - em.opacity) * t;
      if (em.fadeIn > 0 && t < em.fadeIn) alpha *= t / em.fadeIn;
      c[i * 4] = _color.r * em.intensity;
      c[i * 4 + 1] = _color.g * em.intensity;
      c[i * 4 + 2] = _color.b * em.intensity;
      c[i * 4 + 3] = alpha;
      sr[i * 2] = pool.size[i] * (1 + (em.sizeEnd - 1) * t);
      sr[i * 2 + 1] = pool.rot[i];
    }
    for (const a of [offset, velocity, color, sizeRotation]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, pool.count * a.itemSize); // 只上傳有用到的部分
      a.needsUpdate = true;
    }
    (pool.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = pool.count;
  }

  private release(e: Entity): void {
    const pool = this.pools.get(e);
    if (!pool) return;
    pool.mesh.removeFromParent();
    pool.mesh.geometry.dispose();
    pool.material.dispose();
    this.pools.delete(e);
  }
}
