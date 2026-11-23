/// <reference types="vite/client" />
import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import helvetiker from '../src/text3d/fonts/helvetiker_bold.typeface.json?raw';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { ScenePlugin, Transform } from '../src/scene';
import { RenderPlugin, SceneObject } from '../src/render';
import { AssetPlugin, type AssetLoader } from '../src/assets';
import { BUILTIN_FONT, Text3D, Text3DPlugin, load } from '../src/text3d';
import { fakeScheduler } from './helpers';

/** 假畫布：每個字元寬 0.6 × 字級 */
function fakeCanvas() {
  const drawn: string[] = [];
  const ctx = {
    font: '10px x',
    fillStyle: '',
    textBaseline: '',
    measureText(t: string) {
      const px = parseFloat(/(\d+)px/.exec(this.font)![1]);
      return { width: [...t].length * px * 0.6 };
    },
    fillText(t: string) {
      drawn.push(t);
    },
    fillRect() {},
  };
  const canvas = { width: 1, height: 1, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, drawn };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const clock = fakeScheduler();
  const ecs = new EcsPlugin();
  const assets = new AssetPlugin({ noDefaultLoaders: true });
  let fontLoads = 0;
  const fontLoader: AssetLoader<Font> = {
    extensions: ['.typeface.json'],
    load: async () => {
      fontLoads++;
      return new Font(JSON.parse(helvetiker));
    },
  };
  assets.assets.registerLoader('font', fontLoader);
  const fake = fakeCanvas();
  const fakeRenderer = {
    domElement: { parentElement: null, remove() {} },
    shadowMap: {},
    setPixelRatio() {},
    setSize() {},
    render() {},
    clear() {},
    dispose() {},
  } as unknown as import('three/webgpu').WebGPURenderer;
  const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
  engine
    .use(ecs)
    .use(new ScenePlugin())
    .use(new RenderPlugin({ renderer: fakeRenderer, size: { width: 10, height: 10 } }))
    .use(assets)
    .use(new Text3DPlugin({ createCanvas: () => fake.canvas }));
  engine.start();
  const frame = () => clock.frame(16);
  return { world: ecs.world, assets: assets.assets, frame, fake, fontLoads: () => fontLoads };
}

describe('立體文字（extrude）', () => {
  test('沒有指定 font：使用引擎內建的字型（不經過資源載入、不需要專案放字型檔）', async () => {
    const { world, frame, fontLoads } = setup();
    const e = world.spawn(Transform, Text3D.with({ text: 'HERO', size: 1, depth: 0.2 }));
    const f = world.spawn(Transform, Text3D.with({ text: 'ENGINE', font: BUILTIN_FONT }));
    frame();
    expect(world.get(e, Text3D)!.status).toBe('loading');
    await load.builtinFont();
    await tick();
    frame();
    expect(world.get(e, Text3D)!.status).toBe('ready');
    expect(world.get(f, Text3D)!.status).toBe('ready');
    expect(fontLoads()).toBe(0); // 沒有用資源管理器載入
    const mesh = world.get(e, SceneObject)!.object as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.max.x - mesh.geometry.boundingBox!.min.x).toBeGreaterThan(2);
    expect(await load.builtinFont()).toBe(await load.builtinFont()); // 共用同一份
  });

  test('載入字型後建立網格；水平置中、底部對齊', async () => {
    const { world, frame } = setup();
    const e = world.spawn(
      Transform,
      Text3D.with({ text: 'HELLO', font: 'fonts/a.typeface.json', size: 1, depth: 0.4 }),
    );
    frame();
    expect(world.get(e, Text3D)!.status).toBe('loading');
    await tick();
    frame();
    const t = world.get(e, Text3D)!;
    expect(t.status).toBe('ready');
    const mesh = world.get(e, SceneObject)!.object as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeGreaterThan(3); // 五個字母寬度大於 3
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.z - box.min.z).toBeCloseTo(0.4, 5);
  });

  test('改文字會重建並釋放舊幾何；對齊方式；同一字型共用', async () => {
    const { world, frame, fontLoads } = setup();
    const e = world.spawn(
      Transform,
      Text3D.with({ text: 'A', font: 'f.typeface.json', align: 'left', anchorY: 'top' }),
    );
    world.spawn(Transform, Text3D.with({ text: 'B', font: 'f.typeface.json' }));
    frame();
    await tick();
    frame();
    const first = world.get(e, SceneObject)!.object as THREE.Mesh;
    first.geometry.computeBoundingBox();
    expect(first.geometry.boundingBox!.min.x).toBeCloseTo(0, 5);
    expect(first.geometry.boundingBox!.max.y).toBeCloseTo(0, 5);
    let disposed = false;
    first.geometry.addEventListener('dispose', () => (disposed = true));
    world.get(e, Text3D)!.text = 'AB';
    frame();
    expect(disposed).toBe(true);
    expect(world.get(e, SceneObject)!.object).not.toBe(first);
    expect(fontLoads()).toBe(1);
  });

  test('移除元件會清理並釋放字型', async () => {
    const { world, frame, assets } = setup();
    const e = world.spawn(Transform, Text3D.with({ text: 'X', font: 'f.typeface.json' }));
    frame();
    await tick();
    frame();
    expect(assets.refCount('f.typeface.json', 'font')).toBe(1);
    world.remove(e, Text3D);
    expect(world.has(e, SceneObject)).toBe(false);
    expect(assets.refCount('f.typeface.json', 'font')).toBe(0);
  });

  test('字型載入失敗時狀態為 error', async () => {
    const { world, frame, assets } = setup();
    assets.registerLoader('ttf', {
      extensions: ['.ttf'],
      load: async () => {
        throw new Error('壞掉的字型');
      },
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = world.spawn(Transform, Text3D.with({ text: 'X', font: 'broken.ttf' }));
    frame();
    await tick();
    frame();
    expect(world.get(e, Text3D)!.status).toBe('error');
    err.mockRestore();
  });
});

describe('平面文字（flat）', () => {
  test('畫布繪製多行文字；世界尺寸依字高計算；中心對齊', () => {
    const { world, frame, fake } = setup();
    const e = world.spawn(
      Transform,
      Text3D.with({
        mode: 'flat',
        text: '守衛\nGuard',
        size: 0.5,
        resolution: 100,
        padding: 0,
        lineHeight: 1,
        anchorY: 'middle',
      }),
    );
    frame();
    expect(world.get(e, Text3D)!.status).toBe('ready');
    expect(fake.drawn).toEqual(['守衛', 'Guard']);
    const mesh = world.get(e, SceneObject)!.object as THREE.Mesh;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!;
    // 最寬一行 5 字 × 60px = 300px → 1.5；兩行 × 100px = 200px → 1.0
    expect(box.max.x - box.min.x).toBeCloseTo(1.5, 5);
    expect(box.max.y - box.min.y).toBeCloseTo(1.0, 5);
    expect((box.min.y + box.max.y) / 2).toBeCloseTo(0, 5);
    expect((mesh.material as THREE.MeshBasicMaterial).map).toBeInstanceOf(THREE.CanvasTexture);
  });

  test('billboard 使用永遠面向攝影機的精靈', () => {
    const { world, frame } = setup();
    const e = world.spawn(Transform, Text3D.with({ mode: 'flat', text: 'Hi', billboard: true, anchorY: 'bottom' }));
    frame();
    const group = world.get(e, SceneObject)!.object!;
    const sprite = group.children[0] as THREE.Sprite;
    expect(sprite).toBeInstanceOf(THREE.Sprite);
    expect(sprite.center.y).toBe(0);
  });

  test('切換模式會換掉物件', async () => {
    const { world, frame } = setup();
    const e = world.spawn(Transform, Text3D.with({ mode: 'flat', text: 'A', font: 'f.typeface.json' }));
    frame();
    const flat = world.get(e, SceneObject)!.object;
    world.get(e, Text3D)!.mode = 'extrude';
    frame();
    await tick();
    frame();
    expect(world.get(e, SceneObject)!.object).not.toBe(flat);
    expect(world.get(e, Text3D)!.status).toBe('ready');
  });
});
