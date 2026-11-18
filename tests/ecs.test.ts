import { describe, expect, test } from 'vitest';
import { Engine } from '../src/core';
import { EcsPlugin, World, define, entityId, type Entity } from '../src/ecs';
import { fakeScheduler } from './helpers';

const Pos = define.component('Pos', () => ({ x: 0 }));
const Vel = define.component('Vel', () => ({ v: 1 }));
const Frozen = define.tag('Frozen');

describe('實體', () => {
  test('索引重複使用時世代不同，舊編號失效', () => {
    const w = new World();
    const a = w.create();
    w.destroy(a);
    const b = w.create();
    expect(entityId.index(a)).toBe(entityId.index(b));
    expect(a).not.toBe(b);
    expect(w.isAlive(a)).toBe(false);
    expect(w.get(a, Pos)).toBeUndefined();
    expect(() => w.add(a, Pos)).toThrow(/已銷毀/);
  });
});

describe('元件與查詢', () => {
  test('查詢、快取、排除', () => {
    const w = new World();
    const e1 = w.spawn(Pos.with({ x: 1 }), Vel);
    const e2 = w.spawn(Pos.with({ x: 2 }), Vel, Frozen);
    const e3 = w.spawn(Pos);
    const q = w.query([Pos, Vel], { none: [Frozen] });
    expect([...q.entities]).toEqual([e1]);
    expect(w.query([Vel, Pos], { none: [Frozen] })).toBe(q);
    const snapshot = q.entities;
    expect(q.entities).toBe(snapshot);
    w.remove(e2, Frozen);
    expect([...q.entities].sort()).toEqual([e1, e2].sort());
    w.add(e3, Vel);
    expect(q.size).toBe(3);
  });

  test('重複 add 會合併資料', () => {
    const w = new World();
    const e = w.spawn(Pos.with({ x: 1 }));
    w.add(e, Pos, { x: 9 });
    expect(w.get(e, Pos)!.x).toBe(9);
  });

  test('each 走訪中銷毀實體會跳過', () => {
    const w = new World();
    for (let i = 0; i < 5; i++) w.spawn(Pos, Vel);
    const q = w.query([Pos, Vel]);
    const seen: Entity[] = [];
    q.each((e) => {
      seen.push(e);
      if (seen.length === 1) for (const o of q.entities) if (o !== e) w.destroy(o);
    });
    expect(seen).toHaveLength(1);
    expect(q.size).toBe(1);
  });

  test('交換刪除後資料仍正確', () => {
    const w = new World();
    const es = Array.from({ length: 10 }, (_, i) => w.spawn(Pos.with({ x: i })));
    w.destroy(es[0]);
    w.destroy(es[5]);
    for (let i = 0; i < 10; i++) if (i !== 0 && i !== 5) expect(w.get(es[i], Pos)!.x).toBe(i);
  });
});

describe('掛鉤、延後執行', () => {
  test('觸發順序', () => {
    const w = new World();
    const log: string[] = [];
    w.onAdd(Pos, (_e, p) => log.push(`add${p.x}`));
    w.onRemove(Pos, (_e, p) => log.push(`rm${p.x}`));
    w.onDestroy((e) => log.push(`destroy:${w.has(e, Pos)}`));
    w.destroy(w.spawn(Pos.with({ x: 7 })));
    expect(log).toEqual(['add7', 'destroy:true', 'rm7']);
  });

  test('defer 中再 defer 也會執行', () => {
    const w = new World();
    const log: string[] = [];
    w.defer(() => {
      log.push('d1');
      w.defer(() => log.push('d2'));
    });
    expect(log).toEqual([]);
    w.flush();
    expect(log).toEqual(['d1', 'd2']);
  });
});

describe('ECS 外掛', () => {
  test('系統順序、階段結束時執行延後指令、停用系統', () => {
    const clock = fakeScheduler();
    const ecs = new EcsPlugin();
    const log: string[] = [];
    ecs.addSystem({ name: 'b', priority: 5, run: () => log.push('b') });
    ecs.addSystem({
      name: 'a',
      run: (w) => {
        log.push('a');
        w.query([Pos]).each((e) =>
          w.defer(() => {
            log.push('flush');
            w.destroy(e);
          }),
        );
      },
    });
    ecs.addSystem({ name: 'late', phase: 'lateUpdate', run: (w) => log.push(`late:${w.query([Pos]).size}`) });
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    engine.use(ecs);
    ecs.world.spawn(Pos);
    engine.start();
    clock.frame(16);
    expect(log).toEqual(['a', 'b', 'flush', 'late:0']);
    ecs.setEnabled('a', false);
    log.length = 0;
    clock.frame(16);
    expect(log).toEqual(['b', 'late:0']);
    expect(() => ecs.addSystem({ name: 'b', run() {} })).toThrow(/已存在/);
  });
});
