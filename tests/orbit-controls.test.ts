import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin, type World } from '../src/ecs';
import { ScenePlugin, Transform } from '../src/scene';
import {
  Camera,
  OrbitControl,
  OrbitController,
  RenderPlugin,
  type CameraData,
  type OrbitControlData,
} from '../src/render';
import { fakeScheduler } from './helpers';

/** 模擬瀏覽器的 window 與畫布（Node 沒有 DOM） */
let win: EventTarget;
beforeEach(() => {
  win = new EventTarget();
  vi.stubGlobal('window', win);
});
afterEach(() => {
  vi.unstubAllGlobals();
  RenderPlugin.defaults = {};
});

function fakeCanvas() {
  return Object.assign(new EventTarget(), { clientWidth: 800, clientHeight: 600, style: {} as Record<string, string> });
}

type Fields = Partial<{
  pointerId: number;
  clientX: number;
  clientY: number;
  button: number;
  shiftKey: boolean;
  deltaY: number;
}>;
const event = (type: string, fields: Fields = {}) =>
  Object.assign(new Event(type, { cancelable: true }), {
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    deltaY: 0,
    deltaMode: 0,
    ...fields,
  });

function setup(control: Partial<OrbitControlData> = {}, camera: Partial<CameraData> = {}) {
  const ecs = new EcsPlugin();
  const engine = new Engine({ scheduler: fakeScheduler().scheduler, pauseOnHidden: false });
  engine.use(ecs).use(new ScenePlugin());
  const world: World = ecs.world;
  const cam = world.spawn(Camera.with(camera));
  world.add(cam, Transform).position.set(0, 0, 10);
  world.add(cam, OrbitControl, { target: new THREE.Vector3(0, 0, 0), damping: 0, ...control });
  const canvas = fakeCanvas();
  const orbit = new OrbitController(world, canvas as unknown as HTMLCanvasElement, () => cam);
  const t = world.require(cam, Transform);
  const drag = (dx: number, dy: number, fields: Fields = {}) => {
    canvas.dispatchEvent(event('pointerdown', { clientX: 100, clientY: 100, ...fields }));
    win.dispatchEvent(event('pointermove', { clientX: 100 + dx, clientY: 100 + dy }));
    win.dispatchEvent(event('pointerup', { clientX: 100 + dx, clientY: 100 + dy }));
    orbit.update(1 / 60);
  };
  const wheel = (deltaY: number) => {
    const e = event('wheel', { deltaY });
    canvas.dispatchEvent(e);
    orbit.update(1 / 60);
    return e;
  };
  return { world, cam, t, canvas, orbit, drag, wheel };
}

/** 攝影機的正前方（-Z） */
const forward = (t: { rotation: THREE.Quaternion }) => new THREE.Vector3(0, 0, -1).applyQuaternion(t.rotation);

describe('OrbitControl：滑鼠操作', () => {
  test('左鍵拖曳：繞著目標轉，距離不變，一直看著目標', () => {
    const { t, drag } = setup();
    drag(150, 0); // 往右拖
    expect(t.position.length()).toBeCloseTo(10, 5);
    expect(t.position.x).toBeLessThan(-1); // 攝影機繞到左邊（畫面裡的物體往右轉）
    expect(t.position.y).toBeCloseTo(0, 5);
    expect(forward(t).dot(t.position.clone().negate().normalize())).toBeCloseTo(1, 5); // 看著原點
    drag(0, 200); // 往下拖：攝影機往上
    expect(t.position.y).toBeGreaterThan(1);
    expect(t.position.length()).toBeCloseTo(10, 5);
  });

  test('上下角度有限制：不會翻過頭頂', () => {
    const { t, drag } = setup({ maxPolarAngle: Math.PI / 2 });
    drag(0, -5000); // 一直往上拖：攝影機往下，最多到水平
    expect(t.position.y).toBeGreaterThanOrEqual(-1e-6);
    drag(0, 5000);
    expect(t.position.y).toBeCloseTo(10, 1); // 最多到正上方
  });

  test('滾輪縮放；距離有範圍；會阻止頁面捲動', () => {
    const { t, wheel } = setup({ minDistance: 2, maxDistance: 20 });
    const e = wheel(-100); // 往上捲：拉近
    expect(e.defaultPrevented).toBe(true);
    expect(t.position.length()).toBeLessThan(10);
    for (let i = 0; i < 50; i++) wheel(-200);
    expect(t.position.length()).toBeCloseTo(2, 5);
    for (let i = 0; i < 50; i++) wheel(200);
    expect(t.position.length()).toBeCloseTo(20, 5);
  });

  test('右鍵或 Shift＋拖曳：平移目標點', () => {
    const { world, cam, t, drag } = setup();
    drag(100, 0, { button: 2 });
    const target = world.require(cam, OrbitControl).target!;
    expect(target.x).toBeLessThan(0); // 往右拖：場景跟著往右，目標往左
    expect(t.position.x).toBeCloseTo(target.x, 5); // 攝影機一起平移，朝向不變
    drag(0, 100, { shiftKey: true });
    expect(target.y).toBeGreaterThan(0);
  });

  test('關掉的功能不會動', () => {
    const { t, drag, wheel } = setup({ rotate: false, zoom: false, pan: false });
    drag(200, 100);
    drag(200, 100, { button: 2 });
    wheel(-300);
    expect(t.position.toArray()).toEqual([0, 0, 10]);
  });

  test('正交攝影機：滾輪改變 zoom（不是距離）', () => {
    const { world, cam, t, wheel } = setup({}, { kind: 'orthographic' });
    wheel(-200);
    expect(world.require(cam, Camera).zoom).toBeGreaterThan(1);
    expect(t.position.length()).toBeCloseTo(10, 5);
  });

  test('慣性：放開後還會繼續轉一點，然後停下', () => {
    const { t, drag, orbit } = setup({ damping: 0.1 });
    drag(150, 0);
    const x1 = t.position.x;
    orbit.update(1 / 60);
    const x2 = t.position.x;
    expect(x2).toBeLessThan(x1); // 繼續往同一個方向
    for (let i = 0; i < 300; i++) orbit.update(1 / 60);
    const x3 = t.position.x;
    orbit.update(1 / 60);
    expect(t.position.x).toBeCloseTo(x3, 6); // 停下來了
  });
});

describe('OrbitControl：等使用者操作才接手', () => {
  test('操作前：不改攝影機（範例自己的動畫照常）；操作後才控制', () => {
    const { t, drag, orbit } = setup({ waitForInput: true, target: null });
    t.position.set(0, 3, 8); // 範例自己移動攝影機
    orbit.update(1 / 60);
    expect(t.position.toArray()).toEqual([0, 3, 8]);
    drag(100, 0);
    expect(t.position.length()).toBeCloseTo(Math.hypot(3, 8), 5); // 從目前的位置開始轉
    expect(t.position.x).toBeLessThan(0);
  });

  test('wheelNeedsFocus：沒點過畫面時滾輪照常捲動頁面', () => {
    const { t, canvas, wheel } = setup({ wheelNeedsFocus: true });
    expect(wheel(-200).defaultPrevented).toBe(false);
    expect(t.position.length()).toBeCloseTo(10, 5);
    canvas.dispatchEvent(event('pointerdown'));
    win.dispatchEvent(event('pointerup'));
    expect(wheel(-200).defaultPrevented).toBe(true);
    expect(t.position.length()).toBeLessThan(10);
    canvas.dispatchEvent(event('pointerleave')); // 滑鼠離開後又需要點一下
    expect(wheel(-200).defaultPrevented).toBe(false);
  });
});

describe('RenderPlugin 的 orbitControls', () => {
  function fakeRenderer() {
    const canvas = Object.assign(fakeCanvas(), { parentElement: {}, remove() {} });
    return {
      domElement: canvas,
      shadowMap: {},
      setPixelRatio() {},
      getPixelRatio: () => 1,
      setSize() {},
      render() {},
      clear() {},
      dispose() {},
    } as unknown as THREE.WebGLRenderer;
  }

  const run = (options: ConstructorParameters<typeof RenderPlugin>[0] = {}) => {
    const clock = fakeScheduler();
    const ecs = new EcsPlugin();
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    engine
      .use(ecs)
      .use(new ScenePlugin())
      .use(new RenderPlugin({ renderer: fakeRenderer(), size: { width: 800, height: 600 }, ...options }));
    engine.start();
    const cam = ecs.world.spawn(Camera, Transform);
    for (let i = 0; i < 3; i++) clock.frame(16);
    return { world: ecs.world, cam };
  };

  test('預設不加；orbitControls: true 時自動加到目前的攝影機（等操作才接手）', () => {
    expect(run().world.has(run().cam, OrbitControl)).toBe(false);
    const { world, cam } = run({ orbitControls: true });
    expect(world.require(cam, OrbitControl).waitForInput).toBe(true);
  });

  test('RenderPlugin.defaults：所有 RenderPlugin 都開啟（手冊範例用）；建構時的選項優先', () => {
    RenderPlugin.defaults.orbitControls = { wheelNeedsFocus: true };
    const a = run();
    expect(a.world.require(a.cam, OrbitControl).wheelNeedsFocus).toBe(true);
    const b = run({ orbitControls: false });
    expect(b.world.has(b.cam, OrbitControl)).toBe(false);
  });
});

test('沒有操作時不改攝影機；遊戲程式移動攝影機後，從新的位置接著轉', () => {
  const { t, drag, orbit } = setup();
  drag(100, 0);
  t.position.set(0, 0, 4); // 遊戲把攝影機拉近
  orbit.update(1 / 60);
  expect(t.position.toArray()).toEqual([0, 0, 4]);
  drag(50, 0);
  expect(t.position.length()).toBeCloseTo(4, 5);
});
