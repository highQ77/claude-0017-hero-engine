/**
 * 精簡寫法：ecs.each、world.require、Transform.at、math.rotate／setRotation、spawn.entity（父節點、名稱）、setHandlers
 */
import { describe, expect, test, vi } from 'vitest';
import { Vector3, type WebGLRenderer } from 'three';
import { Engine } from '../src/core';
import { EcsPlugin, World, define } from '../src/ecs';
import { Name, Parent, ScenePlugin, Transform, math } from '../src/scene';
import { MeshRenderer, RenderPlugin, spawn } from '../src/render';
import { UI2D, measure } from '../src/ui2d';
import { fakeScheduler } from './helpers';

function setup() {
  const clock = fakeScheduler();
  const ecs = new EcsPlugin();
  const renderer = {
    domElement: { parentElement: null, remove() {} },
    shadowMap: { enabled: false, type: 0 },
    setPixelRatio() {},
    setSize() {},
    render() {},
    clear() {},
    dispose() {},
  } as unknown as WebGLRenderer;
  const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
  engine
    .use(ecs)
    .use(new ScenePlugin())
    .use(new RenderPlugin({ renderer, size: { width: 10, height: 10 } }));
  engine.start();
  return { engine, ecs, world: ecs.world, clock };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

describe('ecs.each', () => {
  test('每幀對符合的實體逐一處理，最後一個參數是時間；可以排除元件、指定順序', () => {
    const { ecs, world, clock } = setup();
    const Spin = define.component('Spin', () => ({ speed: 1 }));
    const Frozen = define.tag('Frozen');
    const a = world.spawn(Transform, Spin.with({ speed: 2 }));
    const b = world.spawn(Transform, Spin, Frozen);
    const order: string[] = [];
    ecs.each(
      'spin',
      [Transform, Spin],
      (_e, t, s, time) => {
        t.position.x += s.speed * time.delta;
        order.push('spin');
      },
      { none: [Frozen], priority: 5 },
    );
    ecs.addSystem({ name: 'first', priority: 1, run: () => order.push('first') });
    clock.frame(1000);
    clock.frame(500);
    expect(round(world.require(a, Transform).position.x)).toBeGreaterThan(0);
    expect(world.require(b, Transform).position.x).toBe(0);
    expect(order.slice(0, 2)).toEqual(['first', 'spin']);
    expect(() => ecs.each('spin', [Spin], () => {})).toThrow(/已存在/);
  });
});

describe('world.require', () => {
  test('沒有元件或實體已銷毀時，錯誤訊息說明是哪個', () => {
    const world = new World();
    const e = world.spawn(Transform);
    expect(world.require(e, Transform).scale.x).toBe(1);
    expect(() => world.require(e, MeshRenderer)).toThrow(/沒有元件「MeshRenderer」/);
    world.destroy(e);
    expect(() => world.require(e, Transform)).toThrow(/已經銷毀/);
  });
});

describe('Transform.at、math.rotate／setRotation', () => {
  test('Transform.at 指定位置；仍是同一種元件', () => {
    const world = new World();
    const a = world.spawn(Transform.at(1, 2, 3));
    const b = world.spawn(Transform.at([4, 5]));
    expect(world.require(a, Transform).position.toArray()).toEqual([1, 2, 3]);
    expect(world.require(b, Transform).position.toArray()).toEqual([4, 5, 0]);
    expect(world.query([Transform]).entities).toHaveLength(2);
    expect(Transform.name).toBe('Transform');
  });

  test('rotate 累加、setRotation 取代（弧度）', () => {
    const t = Transform.create();
    math.rotate(t, [0, Math.PI / 4, 0]);
    math.rotate(t, [0, Math.PI / 4, 0]);
    expect(math.rotate(Transform.create(), [0, 0, 0]).rotation.w).toBe(1);
    // (1, 0, 0) 繞 Y 轉 90 度 → (0, 0, -1)
    const v = new Vector3(1, 0, 0).applyQuaternion(t.rotation);
    expect(v.toArray().map(round)).toEqual([0, 0, -1]);
    math.setRotation(t, [0, 0, 0]);
    expect(round(t.rotation.w)).toBe(1);
  });
});

describe('spawn.entity 與 parent、name', () => {
  test('位置、旋轉、縮放、父節點、名稱、其他元件', () => {
    const { world } = setup();
    const Health = define.component('Health', () => ({ hp: 3 }));
    const root = spawn.mesh(world, { geometry: { box: 1 }, material: '#fff', name: '箱子', position: [1, 0, 0] });
    const child = spawn.entity(
      world,
      { position: [0, 1, 0], scale: 2, parent: root, name: '名牌' },
      Health.with({ hp: 9 }),
    );
    expect(world.require(root, Name).value).toBe('箱子');
    expect(world.require(child, Parent).entity).toBe(root);
    expect(world.require(child, Name).value).toBe('名牌');
    expect(world.require(child, Health).hp).toBe(9);
    expect(world.require(child, Transform).scale.toArray()).toEqual([2, 2, 2]);
    const cam = spawn.camera(world, { parent: root });
    expect(world.require(cam, Parent).entity).toBe(root);
    // 沒有場景外掛（沒有 Hierarchy）時也能設定父節點
    const w = new World();
    const p = w.spawn(Transform);
    expect(w.require(spawn.entity(w, { parent: p }), Parent).entity).toBe(p);
  });
});

describe('setHandlers', () => {
  test('2D 介面一次註冊多個', async () => {
    const ui = await UI2D.create({ container: null, width: 100, height: 100, measure: measure.fixed(0.5) });
    const a = vi.fn();
    ui.setHandlers({ a, b: () => {} });
    ui.handlers.a?.({} as never);
    expect(a).toHaveBeenCalled();
    expect(Object.keys(ui.handlers)).toEqual(expect.arrayContaining(['a', 'b']));
    ui.destroy();
  });
});
