import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin, type Entity } from '../src/ecs';
import { ScenePlugin, Transform } from '../src/scene';
import { RenderPlugin } from '../src/render';
import { ParticleEmitter, ParticlePlugin, ParticlePresets, play } from '../src/particles';
import { fakeScheduler } from './helpers';

function setup() {
  const clock = fakeScheduler();
  const ecs = new EcsPlugin();
  const fakeRenderer = {
    domElement: { parentElement: null, remove() {} },
    shadowMap: {},
    setPixelRatio() {},
    setSize() {},
    render() {},
    clear() {},
    dispose() {},
  } as unknown as THREE.WebGLRenderer;
  const render = new RenderPlugin({ renderer: fakeRenderer, size: { width: 10, height: 10 } });
  const particles = new ParticlePlugin();
  const engine = new Engine({ scheduler: clock.scheduler, fixedDelta: 0.1, maxDelta: 0.1, pauseOnHidden: false });
  engine.use(ecs).use(new ScenePlugin()).use(render).use(particles);
  engine.start();
  const world = ecs.world;
  /** 推進 seconds 秒，每幀 0.1 秒 */
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 10); i++) clock.frame(100);
  };
  const meshOf = () =>
    render.scene.children.find(
      (c) => c.userData.entity !== undefined && (c as THREE.Mesh).geometry instanceof THREE.InstancedBufferGeometry,
    ) as THREE.Mesh | undefined;
  return { world, run, render, particles, engine, meshOf, clock };
}

/** 讀出某個粒子的繪製屬性 */
function attr(mesh: THREE.Mesh, name: string, i: number, itemSize: number): number[] {
  const a = mesh.geometry.getAttribute(name).array as Float32Array;
  return Array.from(a.slice(i * itemSize, i * itemSize + itemSize));
}

describe('粒子發射', () => {
  test('依每秒數量持續發射；壽命到了就消失', () => {
    const { world, run } = setup();
    // 壽命 0.95 秒：避開剛好 1 秒時的浮點邊界
    const e = world.spawn(Transform, ParticleEmitter.with({ rate: 10, lifetime: 0.95 }));
    run(0.5);
    const em = world.get(e, ParticleEmitter)!;
    expect(em.aliveCount).toBe(5);
    run(2);
    expect(em.aliveCount).toBe(10); // 每秒 10 個、活約 1 秒 → 穩定在 10 個
    em.playing = false;
    run(1.1);
    expect(em.aliveCount).toBe(0);
  });

  test('一次發射（play.burst）與上限', () => {
    const { world, run } = setup();
    const e = world.spawn(Transform, ParticleEmitter.with({ rate: 0, maxParticles: 50, lifetime: 5 }));
    const em = world.get(e, ParticleEmitter)!;
    play.burst(em, 30);
    run(0.1);
    expect(em.aliveCount).toBe(30);
    play.burst(em, 30);
    run(0.1);
    expect(em.aliveCount).toBe(50); // 不超過上限
    expect(em.burstCount).toBe(0);
  });

  test('有限時間、不循環：時間到就停止發射', () => {
    const { world, run } = setup();
    const e = world.spawn(Transform, ParticleEmitter.with({ rate: 10, duration: 1, loop: false, lifetime: 10 }));
    run(3);
    expect(world.get(e, ParticleEmitter)!.aliveCount).toBe(10);
  });

  test('世界空間：從實體位置發射、受加速度與阻力影響', () => {
    const { world, run, meshOf } = setup();
    const e = world.spawn(
      ParticleEmitter.with({
        rate: 0,
        lifetime: 10,
        speed: 0,
        acceleration: { x: 0, y: -10, z: 0 },
      }),
    );
    world.add(e, Transform).position.set(5, 0, 0);
    run(0.1); // 讓世界矩陣算好
    play.burst(world.get(e, ParticleEmitter)!, 1);
    run(0.1); // 出生（年齡 0、在發射點）
    const mesh = meshOf()!;
    expect(attr(mesh, 'offset', 0, 3)).toEqual([5, 0, 0]);
    run(0.1);
    const [x, y] = attr(mesh, 'offset', 0, 3);
    expect(x).toBeCloseTo(5, 5);
    expect(y).toBeLessThan(0); // 往下掉
    // 移動發射器：世界空間的粒子留在原地
    world.get(e, Transform)!.position.set(-5, 0, 0);
    run(0.1);
    expect(attr(mesh, 'offset', 0, 3)[0]).toBeCloseTo(5, 5);
    expect(mesh.matrix.equals(new THREE.Matrix4())).toBe(true);
  });

  test('區域空間：繪製物件跟隨實體', () => {
    const { world, run, meshOf } = setup();
    const e = world.spawn(ParticleEmitter.with({ rate: 10, space: 'local' }));
    world.add(e, Transform).position.set(3, 0, 0);
    run(0.3);
    const p = new THREE.Vector3().setFromMatrixPosition(meshOf()!.matrix);
    expect(p.x).toBe(3);
  });

  test('方向與擴散：spread 為 0 時完全沿著方向', () => {
    const { world, run, meshOf } = setup();
    const e = world.spawn(
      Transform,
      ParticleEmitter.with({
        rate: 0,
        lifetime: 10,
        speed: 2,
        spread: 0,
        direction: { x: 1, y: 0, z: 0 },
      }),
    );
    play.burst(world.get(e, ParticleEmitter)!, 5);
    run(0.1);
    for (let i = 0; i < 5; i++) {
      const [vx, vy, vz] = attr(meshOf()!, 'velocity', i, 3);
      expect([vx, vy, vz].map((n) => Math.round(n * 1000) / 1000 + 0)).toEqual([2, 0, 0]);
    }
  });

  test('發射形狀：球體內、盒子內', () => {
    const { world, run, meshOf } = setup();
    const e = world.spawn(
      Transform,
      ParticleEmitter.with({ rate: 0, lifetime: 10, speed: 0, shape: 'sphere', radius: 2 }),
    );
    play.burst(world.get(e, ParticleEmitter)!, 200);
    run(0.1);
    for (let i = 0; i < 200; i++) {
      expect(new THREE.Vector3(...attr(meshOf()!, 'offset', i, 3)).length()).toBeLessThanOrEqual(2 + 1e-6);
    }
  });

  test('顏色、透明度、大小隨壽命變化；亮度倍率', () => {
    const { world, run, meshOf } = setup();
    const e = world.spawn(
      Transform,
      ParticleEmitter.with({
        rate: 0,
        lifetime: 1,
        speed: 0,
        color: 0xff0000,
        colorEnd: 0x0000ff,
        opacity: 1,
        opacityEnd: 0,
        size: 1,
        sizeEnd: 3,
        intensity: 2,
      }),
    );
    play.burst(world.get(e, ParticleEmitter)!, 1);
    run(0.1); // 出生
    run(0.5); // 壽命走了一半
    const [r, , b, a] = attr(meshOf()!, 'color', 0, 4);
    const half = new THREE.Color(0xff0000).lerp(new THREE.Color(0x0000ff), 0.5);
    expect(r).toBeCloseTo(half.r * 2, 4);
    expect(b).toBeCloseTo(half.b * 2, 4);
    expect(a).toBeCloseTo(0.5, 4);
    expect(attr(meshOf()!, 'sizeRotation', 0, 2)[0]).toBeCloseTo(2, 4);
    expect((meshOf()!.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(1);
  });

  test('淡入：前段壽命從透明開始', () => {
    const { world, run, meshOf } = setup();
    const e = world.spawn(
      Transform,
      ParticleEmitter.with({ rate: 0, lifetime: 1, speed: 0, opacity: 1, opacityEnd: 1, fadeIn: 0.4 }),
    );
    play.burst(world.get(e, ParticleEmitter)!, 1);
    run(0.1); // 出生
    run(0.2); // t = 0.2 → 淡入一半
    expect(attr(meshOf()!, 'color', 0, 4)[3]).toBeCloseTo(0.5, 4);
  });
});

describe('生命週期', () => {
  test('一次性特效播完自動銷毀實體', () => {
    const { world, run, render } = setup();
    const e: Entity = world.spawn(Transform, ParticleEmitter.with(ParticlePresets.explosion()));
    run(0.1);
    expect(world.get(e, ParticleEmitter)!.aliveCount).toBe(120);
    run(2);
    expect(world.isAlive(e)).toBe(false);
    expect(render.scene.children.some((c) => c.userData.entity === e)).toBe(false);
  });

  test('移除元件會釋放繪製資源；改上限會重建', () => {
    const { world, run, meshOf } = setup();
    const e = world.spawn(Transform, ParticleEmitter.with({ rate: 10 }));
    run(0.2);
    const mesh = meshOf()!;
    let disposed = false;
    mesh.geometry.addEventListener('dispose', () => (disposed = true));
    world.get(e, ParticleEmitter)!.maxParticles = 20;
    run(0.1);
    expect(disposed).toBe(true);
    expect(meshOf()).not.toBe(mesh);
    world.remove(e, ParticleEmitter);
    expect(meshOf()).toBeUndefined();
  });

  test('混合模式切換、內建預設都能運作', () => {
    const { world, run, meshOf, particles } = setup();
    const e = world.spawn(Transform, ParticleEmitter.with(ParticlePresets.smoke()));
    run(0.5);
    expect((meshOf()!.material as THREE.ShaderMaterial).blending).toBe(THREE.NormalBlending);
    world.get(e, ParticleEmitter)!.blending = 'additive';
    run(0.1);
    expect((meshOf()!.material as THREE.ShaderMaterial).blending).toBe(THREE.AdditiveBlending);
    for (const preset of [ParticlePresets.fire(), ParticlePresets.sparks()]) {
      world.spawn(Transform, ParticleEmitter.with({ ...preset, burstCount: 10 }));
    }
    run(0.1);
    expect(particles.controller.totalParticles).toBeGreaterThan(20);
  });

  test('引擎時間縮放為 0 時粒子靜止', () => {
    const { world, run, engine } = setup();
    const e = world.spawn(Transform, ParticleEmitter.with({ rate: 10, lifetime: 0.5 }));
    run(0.3);
    const count = world.get(e, ParticleEmitter)!.aliveCount;
    engine.time.timeScale = 0;
    run(2);
    expect(world.get(e, ParticleEmitter)!.aliveCount).toBe(count);
  });
});
