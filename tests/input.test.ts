import { describe, expect, test } from 'vitest';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { GamepadAxis, Input, InputKey, InputPlugin } from '../src/input';
import { fakeScheduler } from './helpers';

/** 假手把 */
function pad(pressed: number[] = [], axes: number[] = [0, 0, 0, 0]): Gamepad {
  return {
    id: 'fake',
    connected: true,
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({
      pressed: pressed.includes(i),
      touched: false,
      value: pressed.includes(i) ? 1 : 0,
    })),
  } as unknown as Gamepad;
}

describe('鍵盤', () => {
  test('按住、這一幀按下、這一幀放開', () => {
    const input = new Input({ getGamepads: () => [] });
    input.keyDown('KeyW');
    input.update();
    expect([input.isDown('KeyW'), input.wasPressed('KeyW')]).toEqual([true, true]);
    input.keyDown('KeyW'); // 長按的重複事件不算再按一次
    input.update();
    expect([input.isDown('KeyW'), input.wasPressed('KeyW')]).toEqual([true, false]);
    input.keyUp('KeyW');
    input.update();
    expect([input.isDown('KeyW'), input.wasReleased('KeyW')]).toEqual([false, true]);
    input.update();
    expect(input.wasReleased('KeyW')).toBe(false);
  });

  test('同一幀內按下又放開仍算按下', () => {
    const input = new Input({ getGamepads: () => [] });
    input.keyDown('Space');
    input.keyUp('Space');
    input.update();
    expect([input.wasPressed('Space'), input.wasReleased('Space'), input.isDown('Space')]).toEqual([true, true, false]);
  });

  test('失去焦點時放開全部', () => {
    const input = new Input({ getGamepads: () => [] });
    input.keyDown('KeyA');
    input.pointerDown(1, 0, 0, 0);
    input.update();
    input.blur();
    input.update();
    expect([input.isDown('KeyA'), input.isDown('Mouse:Left'), input.wasReleased('KeyA')]).toEqual([false, false, true]);
  });
});

describe('滑鼠與觸控', () => {
  test('座標、正規化座標、移動量與滾輪每幀歸零', () => {
    const input = new Input({ getGamepads: () => [] });
    input.pointerMove(50, 25, 200, 100, 3, 4);
    input.pointerMove(150, 75, 200, 100, 2, 1);
    input.wheel(100);
    input.update();
    const p = input.pointer;
    expect([p.x, p.y, p.ndcX, p.ndcY]).toEqual([150, 75, 0.5, -0.5]);
    expect([p.deltaX, p.deltaY, p.wheel, p.inside]).toEqual([5, 5, 100, true]);
    input.update();
    expect([p.deltaX, p.deltaY, p.wheel]).toEqual([0, 0, 0]);
  });

  test('按鍵對應與多點觸控只由第一根手指當主要指標', () => {
    const input = new Input({ getGamepads: () => [] });
    input.pointerDown(1, 2, 0, 0, 'mouse');
    input.update();
    expect(input.wasPressed('Mouse:Right')).toBe(true);
    input.pointerUp(1, 2);

    input.pointerDown(10, 0, 10, 10, 'touch');
    input.pointerDown(11, 0, 90, 90, 'touch');
    input.pointerMove(95, 95, 100, 100, 0, 0, 11); // 第二根手指移動不影響主要座標
    input.update();
    expect(input.pointer.active.size).toBe(2);
    expect(input.pointer.x).toBe(0);
    expect(input.isDown('Mouse:Left')).toBe(true);
    input.pointerUp(11, 0);
    expect(input.isDown('Mouse:Left')).toBe(true);
    input.pointerUp(10, 0);
    expect(input.isDown('Mouse:Left')).toBe(false);
  });
});

describe('手把', () => {
  test('按鍵邊緣、死區、斷線時放開', () => {
    let pads: (Gamepad | null)[] = [pad([0], [0.1, -0.6, 0, 1])];
    const input = new Input({ getGamepads: () => pads, deadzone: 0.2 });
    input.update();
    expect(input.wasPressed('Pad:A')).toBe(true);
    expect(input.wasPressed('Pad0:A')).toBe(true);
    expect(input.isDown('Pad1:A')).toBe(false);
    const axes = input.gamepad!.axes;
    expect(axes[0]).toBe(0);
    expect(axes[1]).toBeCloseTo(-0.5);
    expect(axes[3]).toBe(1);
    input.update();
    expect([input.isDown('Pad:A'), input.wasPressed('Pad:A')]).toEqual([true, false]);
    pads = [null];
    input.update();
    expect([input.isDown('Pad:A'), input.gamepad]).toEqual([false, undefined]);
    expect(() => input.isDown('Pad:Nope')).toThrow(/未知的手把按鍵/);
  });
});

describe('動作對應', () => {
  test('按鍵動作與軸', () => {
    let pads: (Gamepad | null)[] = [];
    const input = new Input({ getGamepads: () => pads });
    input.actions
      .bind('jump', ['Space', 'Pad:A'])
      .bindAxis('moveX', { negative: ['KeyA', 'ArrowLeft'], positive: ['KeyD'], padAxis: GamepadAxis.LeftX })
      .bindAxis('moveY', { negative: ['KeyS'], positive: ['KeyW'], padAxis: GamepadAxis.LeftY, invertPad: true });

    input.keyDown('KeyA');
    input.keyDown('Space');
    input.update();
    expect(input.actions.axis('moveX')).toBe(-1);
    expect(input.actions.wasPressed('jump')).toBe(true);
    input.keyDown('KeyD');
    input.update();
    expect(input.actions.axis('moveX')).toBe(0); // 左右同時按抵銷

    // 兩個綁定都按著時，放開其中一個不算「放開動作」
    pads = [pad([0])];
    input.update();
    input.keyUp('Space');
    input.update();
    expect(input.actions.wasReleased('jump')).toBe(false);
    pads = [pad([], [0, -1, 0, 0])];
    input.update();
    expect(input.actions.wasReleased('jump')).toBe(true);
    expect(input.actions.axis('moveY')).toBe(1); // 搖桿往上，反轉後為正

    expect(() => input.actions.isDown('fly')).toThrow(/未定義的動作/);
    expect(() => input.actions.axis('fly')).toThrow(/未定義的軸動作/);
  });
});

describe('InputPlugin', () => {
  test('註冊資源，並在 input 階段的系統之前結算', () => {
    const clock = fakeScheduler();
    const ecs = new EcsPlugin();
    const plugin = new InputPlugin({ getGamepads: () => [] });
    const seen: boolean[] = [];
    ecs.addSystem({
      name: 'reader',
      phase: 'input',
      run: (w) => seen.push(w.requireResource(InputKey).wasPressed('KeyJ')),
    });
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    engine.use(ecs).use(plugin);
    engine.start();
    plugin.input.keyDown('KeyJ');
    clock.frame(16);
    clock.frame(16);
    expect(seen).toEqual([true, false]);
    engine.removePlugin('input');
    expect(ecs.world.getResource(InputKey)).toBeUndefined();
  });
});
