import { describe, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Engine } from '../src/core';
import { EcsPlugin, World, define, type Entity } from '../src/ecs';
import { Hierarchy, Parent, ScenePlugin, SceneMember, Transform, math, tick } from '../src/scene';
import { fakeScheduler } from './helpers';

const Pos = define.component('Pos', () => ({ x: 0 }));
const Vel = define.component('Vel', () => ({ v: 1 }));

const round = (v: Vector3) => v.toArray().map((n) => Math.round(n * 1e6) / 1e6 + 0);

describe('父子層級與變換', () => {
  test('世界座標、循環檢查、脫離、連帶銷毀', () => {
    const w = new World();
    const h = new Hierarchy(w);
    const a = w.spawn(Transform),
      b = w.spawn(Transform),
      c = w.spawn(Transform);
    w.get(a, Transform)!.position.set(10, 0, 0);
    w.get(a, Transform)!.scale.set(2, 2, 2);
    w.get(b, Transform)!.position.set(1, 0, 0);
    w.get(c, Transform)!.position.set(0, 1, 0);
    h.setParent(b, a);
    h.setParent(c, b);
    expect(() => h.setParent(a, c)).toThrow(/子孫/);
    expect(() => h.setParent(a, a)).toThrow(/子孫/);

    tick.transforms(w);
    expect(round(math.worldPosition(w.get(c, Transform)!))).toEqual([12, 2, 0]);

    h.setParent(c, null);
    tick.transforms(w);
    expect(round(math.worldPosition(w.get(c, Transform)!))).toEqual([0, 1, 0]);

    h.setParent(c, b);
    expect(h.childrenOf(b)).toEqual([c]);
    w.destroy(a);
    expect(w.isAlive(b) || w.isAlive(c)).toBe(false);
    expect(w.entityCount).toBe(0);
  });

  test('math.lookAt 讓 -Z 朝向目標', () => {
    const w = new World();
    const e = w.spawn(Transform);
    const t = w.get(e, Transform)!;
    t.position.set(0, 0, 5);
    math.lookAt(t, new Vector3(0, 0, 0));
    const forward = new Vector3(0, 0, -1).applyQuaternion(t.rotation);
    expect(round(forward)).toEqual([0, 0, -1]);
    t.position.set(5, 0, 0);
    math.lookAt(t, new Vector3(0, 0, 0));
    expect(round(new Vector3(0, 0, -1).applyQuaternion(t.rotation))).toEqual([-1, 0, 0]);
  });
});

describe('場景管理', () => {
  test('歸屬、疊加、persist、切換', () => {
    const clock = fakeScheduler();
    const ecs = new EcsPlugin();
    const sp = new ScenePlugin();
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    expect(() => engine.use(sp)).toThrow(/需要先安裝/);
    engine.use(ecs).use(sp);

    const w = ecs.world;
    const scenes = sp.scenes;
    let persistent!: Entity, child!: Entity;
    scenes.register(
      {
        name: 'A',
        setup: (w) => {
          persistent = w.spawn(Transform);
          child = w.spawn(Transform);
          sp.hierarchy.setParent(child, persistent);
          w.spawn(Pos);
        },
      },
      {
        name: 'B',
        setup: (w) => {
          w.spawn(Pos);
          w.spawn(Pos);
        },
      },
      {
        name: 'UI',
        setup: (w) => {
          w.spawn(Vel);
        },
      },
    );

    const global = w.spawn(Pos); // 沒有場景時建立 → 永久
    scenes.load('A');
    scenes.persist(persistent);
    expect(w.get(child, SceneMember)).toBeUndefined();

    scenes.load('UI', { additive: true });
    const runtime = w.spawn(Pos); // 遊戲中建立 → 屬於主場景
    expect(w.get(runtime, SceneMember)!.scene).toBe('A');
    expect([...scenes.loadedScenes]).toEqual(['A', 'UI']);

    scenes.load('B');
    expect([...scenes.loadedScenes]).toEqual(['B']);
    expect(w.isAlive(global) && w.isAlive(persistent) && w.isAlive(child)).toBe(true);
    expect(w.isAlive(runtime)).toBe(false);
    expect(w.query([Vel]).size).toBe(0);
    expect(w.query([Pos]).size).toBe(3);
    expect(w.query([Transform, Parent]).size).toBe(1);

    engine.destroy();
    expect(w.entityCount).toBe(0);
  });
});
