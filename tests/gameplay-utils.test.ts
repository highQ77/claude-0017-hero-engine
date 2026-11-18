/**
 * 遊戲邏輯小工具：計時器、事件、亂數、曲線、物件池、存檔、記錄器、除錯繪製。
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  Engine,
  Timers,
  createLogger,
  createPool,
  createSave,
  getLogLevel,
  memoryStorage,
  onLog,
  setLogLevel,
  SaveError,
} from '../src/core';
import { EcsPlugin, World, define } from '../src/ecs';
import { Path, Random, Vector3 } from '../src/math';
import { DebugDraw } from '../src/render/DebugDraw';

describe('計時器', () => {
  test('after 只觸發一次、every 每隔一段時間觸發', () => {
    const timers = new Timers();
    const calls: string[] = [];
    timers.after(1, () => calls.push('after'));
    timers.every(0.5, () => calls.push('every'));
    timers.update(0); // 新增的計時器下一幀才開始算
    for (let i = 0; i < 4; i++) timers.update(0.5);
    expect(calls.filter((c) => c === 'after')).toHaveLength(1);
    expect(calls.filter((c) => c === 'every')).toHaveLength(4);
  });

  test('cancel、cancelOwner、realtime', () => {
    const timers = new Timers();
    const fn = vi.fn();
    const h = timers.every(1, fn);
    const owner = {};
    timers.every(1, fn, { owner });
    const real = vi.fn();
    timers.every(1, real, { realtime: true });
    timers.update(0);
    h.cancel();
    timers.cancelOwner(owner);
    expect(h.active).toBe(false);
    timers.update(0, 1); // 遊戲時間沒動（timeScale 0），真實時間過了 1 秒
    expect(fn).not.toHaveBeenCalled();
    expect(real).toHaveBeenCalledTimes(1);
  });

  test('回呼出錯不影響其他計時器；卡頓時 every 最多補 10 次', () => {
    const timers = new Timers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = vi.fn();
    timers.after(0, () => {
      throw new Error('boom');
    });
    timers.every(0.01, ok);
    timers.update(0);
    timers.update(10);
    expect(error).toHaveBeenCalled();
    expect(ok).toHaveBeenCalledTimes(10);
    error.mockRestore();
  });

  test('引擎：跟著 timeScale；綁定的實體銷毀時取消', () => {
    const engine = new Engine();
    const ecs = new EcsPlugin();
    engine.use(ecs);
    const e = ecs.world.spawn();
    const fn = vi.fn();
    const bound = vi.fn();
    engine.timers.after(1, fn);
    engine.timers.after(1, bound, { owner: e });
    engine.stepFrame(0.01);
    engine.time.timeScale = 0.5;
    engine.stepFrame(0.1); // 只過了 0.05 秒
    expect(fn).not.toHaveBeenCalled();
    ecs.world.destroy(e);
    engine.time.timeScale = 1;
    for (let i = 0; i < 12; i++) engine.stepFrame(0.1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(bound).not.toHaveBeenCalled();
    engine.destroy();
  });
});

describe('事件', () => {
  const Hit = define.event<{ damage: number }>('Hit');
  const Ping = define.event('Ping');

  test('on、emit、once、off', () => {
    const world = new World();
    const got: number[] = [];
    const off = world.events.on(Hit, (e) => got.push(e.damage));
    world.events.once(Hit, (e) => got.push(e.damage * 10));
    world.events.emit(Hit, { damage: 2 });
    world.events.emit(Hit, { damage: 3 });
    off();
    world.events.emit(Hit, { damage: 4 });
    expect(got).toEqual([2, 20, 3]);
    const ping = vi.fn();
    world.events.on(Ping, ping);
    world.events.emit(Ping);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  test('綁定實體：實體銷毀時自動取消；收聽函式出錯不影響其他', () => {
    const world = new World();
    const e = world.spawn();
    const bound = vi.fn();
    const other = vi.fn();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    world.events.on(Hit, bound, { owner: e });
    world.events.on(Hit, () => {
      throw new Error('boom');
    });
    world.events.on(Hit, other);
    world.destroy(e);
    world.events.emit(Hit, { damage: 1 });
    expect(bound).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('亂數與曲線', () => {
  test('同一個種子得到一樣的結果', () => {
    const a = new Random(42);
    const b = new Random(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(new Random('level-1').next()).toBe(new Random('level-1').next());
    expect(new Random(1).next()).not.toBe(new Random(2).next());
  });

  test('int 包含兩端、pick、weighted、shuffle', () => {
    const rng = new Random(7);
    const ints = new Set(Array.from({ length: 500 }, () => rng.int(1, 6)));
    expect([...ints].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(['a', 'b']).toContain(rng.pick(['a', 'b']));
    expect(rng.weighted([['only', 1]])).toBe('only');
    const arr = [1, 2, 3, 4, 5];
    expect(rng.shuffle([...arr]).sort()).toEqual(arr);
    expect(() => rng.pick([])).toThrow();
  });

  test('Path：頭尾、均勻速度、closed 繞回來', () => {
    const path = new Path([
      [0, 0, 0],
      [10, 0, 0],
    ]);
    expect(path.pointAt(0).distanceTo(new Vector3(0, 0, 0))).toBeLessThan(1e-6);
    expect(path.pointAt(1).distanceTo(new Vector3(10, 0, 0))).toBeLessThan(1e-6);
    expect(path.pointAt(0.5).x).toBeCloseTo(5, 1);
    expect(path.length).toBeCloseTo(10, 3);
    expect(path.tangentAt(0.5).x).toBeCloseTo(1, 3);
    const loop = new Path(
      [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 4],
        [0, 0, 4],
      ],
      { closed: true },
    );
    expect(loop.pointAt(1.25).distanceTo(loop.pointAt(0.25))).toBeLessThan(1e-6);
    expect(loop.sample(8)).toHaveLength(8);
    expect(() => new Path([[0, 0, 0]])).toThrow();
  });
});

describe('物件池', () => {
  test('重複使用放回去的物件；max 以外的交給 destroy', () => {
    let made = 0;
    const destroyed: number[] = [];
    const pool = createPool({
      create: () => ++made,
      onAcquire: vi.fn(),
      onRelease: vi.fn(),
      max: 1,
      destroy: (x) => destroyed.push(x),
    });
    const a = pool.acquire();
    const b = pool.acquire();
    expect(pool.inUse).toBe(2);
    expect(pool.release(a)).toBe(true);
    expect(pool.release(a)).toBe(false); // 放回兩次
    pool.release(b); // 超過 max
    expect(destroyed).toEqual([b]);
    expect(pool.acquire()).toBe(a);
    expect(made).toBe(2);
    pool.prewarm(3);
    expect(pool.free).toBe(3);
  });
});

describe('存檔', () => {
  test('寫入、讀取、列出、刪除', () => {
    const save = createSave<{ level: number }>({ name: 'g', storage: memoryStorage() });
    expect(save.read('a')).toBeNull();
    save.write('a', { level: 3 });
    expect(save.read('a')).toEqual({ level: 3 });
    expect(save.has('a')).toBe(true);
    expect(save.list().map((i) => i.slot)).toEqual(['a']);
    save.remove('a');
    expect(save.has('a')).toBe(false);
    expect(() => save.write('不合法/名稱', { level: 1 })).toThrow(/不合法/);
  });

  test('舊版本用 migrate 轉換；比遊戲新、壞掉、驗證失敗時丟出 SaveError', () => {
    const storage = memoryStorage();
    createSave<{ lv: number }>({ name: 'g', storage, version: 1 }).write('s', { lv: 2 });
    const v2 = createSave<{ level: number }>({
      name: 'g',
      storage,
      version: 2,
      migrate: (old) => ({ level: (old as { lv: number }).lv }),
      validate: (d) => typeof (d as { level?: unknown }).level === 'number',
    });
    expect(v2.read('s')).toEqual({ level: 2 });
    v2.write('s', { level: 5 });
    expect(() => createSave({ name: 'g', storage, version: 1 }).read('s')).toThrow(/比遊戲/);
    storage.setItem('hero-save:g:bad', '{oops');
    expect(() => v2.read('bad')).toThrow(SaveError);
    expect(
      v2
        .list()
        .map((i) => i.slot)
        .sort(),
    ).toEqual(['bad', 's']);
    const strict = createSave({ name: 'g', storage, version: 2, validate: () => false });
    expect(() => strict.read('s')).toThrow(/validate/);
    expect(() => createSave({ name: 'g', storage, version: 3 }).read('s')).toThrow(/migrate/);
  });
});

describe('記錄器', () => {
  afterEach(() => setLogLevel('info'));

  test('等級、前綴、onLog', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const entries: string[] = [];
    const off = onLog((e) => entries.push(`${e.level}:${e.module}`));
    const log = createLogger('test');
    log.debug('不會顯示');
    log.warn('小心', 1);
    expect(debug).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[test] 小心', 1);
    setLogLevel('error');
    log.warn('也不會顯示');
    expect(entries).toEqual(['warn:test']);
    expect(getLogLevel()).toBe('error');
    off();
    expect(() => setLogLevel('loud' as never)).toThrow();
    warn.mockRestore();
    debug.mockRestore();
  });
});

describe('除錯繪製', () => {
  test('只畫一幀的畫完就拿掉；有 duration 的留著；enabled = false 不記錄', () => {
    const debug = new DebugDraw();
    debug.line([0, 0, 0], [1, 0, 0]);
    debug.box([0, 0, 0], 1, { duration: 10 });
    debug.sphere([0, 0, 0], 1, { depthTest: true });
    debug.ray([0, 0, 0], [0, 0, 0]); // 方向是 0：不畫
    expect(debug.count).toBe(3);
    debug._beforeDraw();
    const [onTop, depth] = debug.object.children as import('three').LineSegments[];
    expect(onTop.geometry.drawRange.count).toBe(2 + 24);
    expect(depth.geometry.drawRange.count).toBe(24 * 3 * 2);
    debug._afterDraw();
    expect(debug.count).toBe(1);
    debug.enabled = false;
    debug.point([0, 0, 0]);
    expect(debug.count).toBe(1);
    debug.dispose();
  });
});
