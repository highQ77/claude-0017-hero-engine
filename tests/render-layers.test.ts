import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { ScenePlugin, Transform, parseSceneFile, stringifySceneXml } from '../src/scene';
import {
  Camera,
  CameraLayers,
  CameraViewport,
  LayerNames,
  Light,
  MeshRenderer,
  RenderLayer,
  RenderPlugin,
  cameraLayersCodec,
  cameraViewportCodec,
  renderLayerCodec,
} from '../src/render';
import { fakeScheduler } from './helpers';

/** 繪製器替身：記下每次繪製用的攝影機、畫面範圍 */
function fakeRenderer() {
  const draws: { camera: THREE.Camera; viewport: number[] }[] = [];
  let viewport = [0, 0, 200, 100];
  const renderer = {
    domElement: { parentElement: null, remove() {} },
    shadowMap: { enabled: false, type: 0 },
    autoClear: true,
    setPixelRatio() {},
    setSize() {},
    render(scene: THREE.Scene, camera: THREE.Camera) {
      scene.updateMatrixWorld();
      draws.push({ camera, viewport: [...viewport] });
    },
    clear() {},
    dispose() {},
    setRenderTarget() {},
    setViewport(x: number, y: number, w: number, h: number) {
      viewport = [x, y, w, h];
    },
    setScissor() {},
    setScissorTest() {},
    setClearColor() {},
    getClearColor: (c: THREE.Color) => c,
    getClearAlpha: () => 1,
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, draws };
}

function setup() {
  const clock = fakeScheduler();
  const fake = fakeRenderer();
  const ecs = new EcsPlugin();
  const render = new RenderPlugin({ renderer: fake.renderer, size: { width: 200, height: 100 } });
  const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
  engine.use(ecs).use(new ScenePlugin()).use(render);
  engine.start();
  return { clock, world: ecs.world, render, fake };
}

const geo = new THREE.BoxGeometry(2, 2, 2);
const mat = new THREE.MeshBasicMaterial();

describe('繪製圖層', () => {
  test('名稱自動配編號；default 是 0；超過 32 個丟出錯誤', () => {
    const names = new LayerNames();
    expect(names.bit('default')).toBe(0);
    expect(names.bit('minimap')).toBe(1);
    expect(names.bit('minimap')).toBe(1);
    expect(names.mask(['default', 'minimap'])).toBe(0b11);
    for (let i = 0; i < 30; i++) names.bit(`l${i}`);
    expect(names.bit('l29')).toBe(31);
    expect(names.mask(['l29'])).toBe(2 ** 31); // 第 32 個也是正數
    expect(() => names.bit('one-too-many')).toThrow(/最多 32/);
  });

  test('物件、模型的子物件、攝影機、燈光套用圖層；移除 RenderLayer 恢復 default', () => {
    const { clock, world, render } = setup();
    const box = world.spawn(Transform, MeshRenderer.with({ geometry: geo, material: mat }));
    world.add(box, RenderLayer, { layers: ['minimap'] });
    const cam = world.spawn(Transform, Camera, CameraLayers.with({ layers: ['default', 'minimap'] }));
    const lamp = world.spawn(Transform, Light.with({ kind: 'point' }));
    clock.frame(16);
    const bit = 1 << render.layers.bit('minimap');
    expect(render.getObject(box)!.layers.mask).toBe(bit);
    expect(render.getObject(cam, 'camera')!.layers.mask).toBe(1 | bit);
    expect(render.getObject(lamp, 'light')!.layers.test(new THREE.Layers())).toBe(true);
    expect(render.getObject(lamp, 'light')!.layers.mask >>> 0).toBe(0xffffffff); // 燈光照亮所有圖層
    world.remove(box, RenderLayer);
    clock.frame(16);
    expect(render.getObject(box)!.layers.mask).toBe(1);
  });

  test('點選只會選到目前攝影機看得到的圖層', () => {
    const { clock, world, render } = setup();
    const cam = world.spawn(Transform, Camera.with({ fov: 60 }));
    world.require(cam, Transform).position.set(0, 0, 10);
    const hidden = world.spawn(Transform, MeshRenderer.with({ geometry: geo, material: mat }));
    world.add(hidden, RenderLayer, { layers: ['minimap'] });
    world.require(hidden, Transform).position.set(0, 0, 2);
    const visible = world.spawn(Transform, MeshRenderer.with({ geometry: geo, material: mat }));
    clock.frame(16);
    expect(render.pick(0, 0)!.entity).toBe(visible);
    world.add(cam, CameraLayers, { layers: ['default', 'minimap'] });
    clock.frame(16);
    expect(render.pick(0, 0)!.entity).toBe(hidden);
  });
});

describe('額外的畫面（CameraViewport）', () => {
  test('不當主畫面；主畫面之後畫在指定的範圍，寬高比用那塊範圍的', () => {
    const { clock, world, render, fake } = setup();
    const main = world.spawn(Transform, Camera.with({ priority: 0 }));
    const map = world.spawn(
      Transform,
      Camera.with({ priority: 100 }), // 優先度再高也不會變成主畫面
      CameraViewport.with({ x: 0.75, y: 0.1, width: 0.2, height: 0.4 }),
    );
    clock.frame(16);
    expect(render.activeCamera).toBe(main);
    const mainObj = render.getObject(main, 'camera');
    const mapObj = render.getObject(map, 'camera') as THREE.PerspectiveCamera;
    const last = fake.draws.slice(-2);
    expect(last[0].camera).toBe(mainObj);
    expect(last[1].camera).toBe(mapObj);
    // 200×100 的畫面：x = 150、寬 40、高 40；y 從下面算 = 100 - (0.1 + 0.4) × 100 = 50
    expect(last[1].viewport).toEqual([150, 50, 40, 40]);
    expect(mapObj.aspect).toBeCloseTo(1); // 40 / 40
    // 畫完恢復成整個畫面
    world.require(map, CameraViewport).enabled = false;
    clock.frame(16);
    expect(fake.draws.at(-1)!.camera).toBe(mainObj);
  });
});

describe('場景檔', () => {
  test('RenderLayer、CameraLayers、CameraViewport 可以存讀（圖層名稱用空白隔開）', () => {
    const ctx = { entity: 'a', component: 'RenderLayer', warn() {} };
    expect(renderLayerCodec.write({ layers: ['default'] })).toEqual({});
    expect(renderLayerCodec.write({ layers: ['default', 'minimap'] })).toEqual({ layers: 'default minimap' });
    expect(renderLayerCodec.read({ layers: 'default, minimap' }, ctx)).toEqual({ layers: ['default', 'minimap'] });
    expect(renderLayerCodec.read({ layers: ['minimap'] }, ctx)).toEqual({ layers: ['minimap'] });
    expect(() => renderLayerCodec.read({ layers: ['中文'] }, ctx)).toThrow(/圖層名稱/);
    const xml = `<Scene version="1">
      <Entity id="cam"><CameraLayers layers="minimap"/><CameraViewport x="0.7" width="0.25" background="#000000"/></Entity>
    </Scene>`;
    const file = parseSceneFile(xml);
    const comps = file.entities[0].components!;
    expect(cameraLayersCodec.read(comps.CameraLayers, ctx)).toEqual({ layers: ['minimap'] });
    expect(cameraViewportCodec.read(comps.CameraViewport, ctx)).toEqual({ x: 0.7, width: 0.25, background: '#000000' });
    // 存成 XML 是很好讀的 layers="…"
    const out = stringifySceneXml({
      format: 'hero-scene',
      version: 1,
      entities: [{ id: 'm', components: { RenderLayer: renderLayerCodec.write({ layers: ['default', 'minimap'] }) } }],
    });
    expect(out).toContain('<RenderLayer layers="default minimap"/>');
  });
});
