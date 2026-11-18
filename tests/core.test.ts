import { describe, expect, test } from 'vitest';
import { Engine, create } from '../src/core';
import { fakeScheduler } from './helpers';

function setup() {
  const clock = fakeScheduler();
  const engine = new Engine({
    scheduler: clock.scheduler,
    fixedDelta: 0.01,
    maxDelta: 0.1,
    maxFixedSteps: 5,
    pauseOnHidden: false,
  });
  return { clock, engine };
}

describe('主迴圈', () => {
  test('階段順序與優先度', () => {
    const { clock, engine } = setup();
    const log: string[] = [];
    engine.on('render', () => log.push('render'));
    engine.on('update', () => log.push('update-b'), 1);
    engine.on('update', () => log.push('update-a'), 0);
    engine.on('input', () => log.push('input'));
    engine.on('lateUpdate', () => log.push('late'));
    engine.on('fixedUpdate', () => log.push('fixed'));
    engine.start();
    clock.frame(25);
    expect(log).toEqual(['input', 'fixed', 'fixed', 'update-a', 'update-b', 'late', 'render']);
    expect(engine.time.alpha).toBeCloseTo(0.5);
  });

  test('卡頓時限制單幀時間與補跑次數', () => {
    const { clock, engine } = setup();
    let fixed = 0;
    engine.on('fixedUpdate', () => fixed++);
    engine.start();
    clock.frame(500);
    expect(fixed).toBe(5);
    expect(engine.time.delta).toBeCloseTo(0.1);
    expect(engine.time.realDelta).toBeCloseTo(0.5); // 真實間隔不受限制
  });

  test('時間縮放', () => {
    const { clock, engine } = setup();
    let fixed = 0;
    engine.on('fixedUpdate', () => fixed++);
    engine.start();
    engine.time.timeScale = 0.5;
    clock.frame(40);
    expect(engine.time.elapsed).toBeCloseTo(0.02);
    expect(engine.time.unscaledElapsed).toBeCloseTo(0.04);
    expect(fixed).toBe(2);
    expect(() => (engine.time.timeScale = -1)).toThrow();
  });

  test('暫停、逐幀、恢復', () => {
    const { clock, engine } = setup();
    let updates = 0;
    engine.on('update', () => updates++);
    engine.start();
    engine.pause();
    expect(clock.pending).toBeNull();
    expect(engine.state).toBe('paused');
    engine.stepFrame();
    expect(updates).toBe(1);
    engine.resume();
    clock.advance(10_000); // 暫停很久，恢復後不能一次跳太多
    clock.frame(16);
    expect(engine.time.unscaledDelta).toBeLessThanOrEqual(0.1);
  });

  test('回呼中拋錯不會讓迴圈停止', () => {
    const { clock, engine } = setup();
    engine.on('update', () => {
      throw new Error('boom');
    });
    engine.start();
    expect(() => clock.frame(16)).toThrow('boom');
    expect(clock.pending).not.toBeNull();
  });
});

describe('外掛與生命週期', () => {
  test('依賴檢查與反向卸載', () => {
    const { engine } = setup();
    const removed: string[] = [];
    engine.use({
      name: 'a',
      install() {},
      uninstall() {
        removed.push('a');
      },
    });
    expect(() => engine.use({ name: 'c', dependencies: ['x'], install() {} })).toThrow(/需要先安裝/);
    engine.use({
      name: 'b',
      dependencies: ['a'],
      install() {},
      uninstall() {
        removed.push('b');
      },
    });
    expect(() => engine.use({ name: 'a', install() {} })).toThrow(/已安裝/);
    expect(() => engine.removePlugin('a')).toThrow(/依賴/);
    engine.destroy();
    expect(removed).toEqual(['b', 'a']);
    expect(engine.state).toBe('destroyed');
    expect(() => engine.start()).toThrow(/已銷毀/);
  });

  test('設定驗證', () => {
    expect(() => create.config({ fixedDelta: 0 })).toThrow();
    expect(create.config({ debug: true }).fixedDelta).toBeCloseTo(1 / 60);
  });
});
