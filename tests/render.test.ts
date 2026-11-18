import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { Parent, ScenePlugin, Transform } from '../src/scene';
import { Camera, Light, MeshRenderer, RenderPlugin, SceneObject, spawn } from '../src/render';
import { fakeScheduler } from './helpers';

/** 測試用的繪製器替身（Node 環境沒有 WebGL） */
function fakeRenderer() {
  const calls: { scene: THREE.Scene; camera: THREE.Camera }[] = [];
  let clears = 0;
  let disposed = false;
  const renderer = {
    domElement: { parentElement: null, remove() {} },
    shadowMap: { enabled: false, type: 0 },
    setPixelRatio() {},
    setSize() {},
    render(scene: THREE.Scene, camera: THREE.Camera) {
      // 模擬 three.js：繪製前更新世界矩陣
      scene.updateMatrixWorld();
      calls.push({ scene, camera });
    },
    clear() {
      clears++;
    },
    dispose() {
      disposed = true;
    },
  };
  return {
    renderer: renderer as unknown as THREE.WebGLRenderer,
    calls,
    get clears() {
      return clears;
    },
    get disposed() {
      return disposed;
    },
  };
}

function setup() {
  const clock = fakeScheduler();
  const fake = fakeRenderer();
  const ecs = new EcsPlugin();
  const render = new RenderPlugin({ renderer: fake.renderer, size: { width: 200, height: 100 } });
  const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
  engine.use(ecs).use(new ScenePlugin()).use(render);
  engine.start();
  return { clock, fake, world: ecs.world, render, engine };
}

describe('繪製外掛', () => {
  test('沒有攝影機時只清畫面', () => {
    const { clock, fake } = setup();
    clock.frame(16);
    expect(fake.calls).toHaveLength(0);
    expect(fake.clears).toBe(1);
  });

  test('網格跟隨 Transform 的世界矩陣（含父子層級）', () => {
    const { clock, fake, world, render } = setup();
    world.spawn(Transform, Camera);
    const geo = new THREE.BoxGeometry();
    const mat = new THREE.MeshBasicMaterial();
    const parent = world.spawn(Transform.with({}));
    world.get(parent, Transform)!.position.set(5, 0, 0);
    const child = world.spawn(MeshRenderer.with({ geometry: geo, material: mat, castShadow: true }));
    world.add(child, Transform).position.set(0, 2, 0);
    world.add(child, Parent, { entity: parent }); // 直接加 Parent 也會經由掛鉤更新層級索引

    clock.frame(16);
    const mesh = render.getObject(child) as THREE.Mesh;
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh.geometry).toBe(geo);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.parent).toBe(render.scene);
    expect(new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld).toArray()).toEqual([5, 2, 0]);
    expect(render.entityOf(mesh)).toBe(child);
    expect(fake.calls).toHaveLength(1);

    // 移除元件 → 從場景拿掉，但共用的幾何不會被釋放
    world.remove(child, MeshRenderer);
    expect(mesh.parent).toBeNull();
    expect(render.getObject(child)).toBeUndefined();
  });

  test('選 priority 最高且啟用的攝影機，長寬比跟隨畫面', () => {
    const { clock, fake, world, render } = setup();
    const a = world.spawn(Transform, Camera.with({ priority: 1 }));
    const b = world.spawn(Transform, Camera.with({ priority: 5, fov: 40 }));
    clock.frame(16);
    expect(render.activeCamera).toBe(b);
    const cam = fake.calls.at(-1)!.camera as THREE.PerspectiveCamera;
    expect(cam.fov).toBe(40);
    expect(cam.aspect).toBe(2);

    world.get(b, Camera)!.enabled = false;
    clock.frame(16);
    expect(render.activeCamera).toBe(a);

    render.setSize(100, 100);
    clock.frame(16);
    expect((render.getObject(a, 'camera') as THREE.PerspectiveCamera).aspect).toBe(1);

    // 切換成正交攝影機會替換物件
    world.get(a, Camera)!.kind = 'orthographic';
    world.get(a, Camera)!.size = 3;
    clock.frame(16);
    const ortho = render.getObject(a, 'camera') as THREE.OrthographicCamera;
    expect(ortho).toBeInstanceOf(THREE.OrthographicCamera);
    expect([ortho.top, ortho.right]).toEqual([3, 3]);
  });

  test('燈光：屬性同步、種類改變時替換、方向跟隨變換', () => {
    const { clock, world, render } = setup();
    world.spawn(Transform, Camera); // 有攝影機才會實際繪製（並更新世界矩陣）
    const e = world.spawn(Light.with({ kind: 'point', color: 'red', intensity: 3, distance: 10 }));
    world.add(e, Transform).position.set(1, 2, 3);
    clock.frame(16);
    const point = render.getObject(e, 'light') as THREE.PointLight;
    expect(point).toBeInstanceOf(THREE.PointLight);
    expect(point.color.getHex()).toBe(0xff0000);
    expect([point.intensity, point.distance]).toEqual([3, 10]);

    const light = world.get(e, Light)!;
    light.kind = 'directional';
    light.castShadow = true;
    light.shadowArea = 10;
    clock.frame(16);
    const dir = render.getObject(e, 'light') as THREE.DirectionalLight;
    expect(dir).toBeInstanceOf(THREE.DirectionalLight);
    expect(point.parent).toBeNull();
    expect(dir.castShadow).toBe(true);
    expect(dir.shadow.camera.right).toBe(5);
    // 目標在燈光 -Z 方向
    const target = new THREE.Vector3().setFromMatrixPosition(dir.target.matrixWorld);
    expect(target.toArray()).toEqual([1, 2, 2]);

    // 半球光不受變換影響
    light.kind = 'hemisphere';
    clock.frame(16);
    const hemi = render.getObject(e, 'light')!;
    expect(new THREE.Vector3().setFromMatrixPosition(hemi.matrixWorld).toArray()).toEqual([0, 1, 0]);
  });

  test('SceneObject：之後才填入物件、換物件、銷毀實體', () => {
    const { clock, world, render } = setup();
    const e = world.spawn(Transform, SceneObject);
    clock.frame(16);
    expect(render.getObject(e, 'object')).toBeUndefined();

    const group = new THREE.Group();
    world.get(e, SceneObject)!.object = group;
    clock.frame(16);
    expect(render.getObject(e, 'object')).toBe(group);

    const other = new THREE.Group();
    world.get(e, SceneObject)!.object = other;
    clock.frame(16);
    expect(group.parent).toBeNull();
    expect(other.parent).toBe(render.scene);

    world.destroy(e);
    expect(other.parent).toBeNull();
  });

  test('卸載時清空 three.js 場景並釋放自己建立的資源', () => {
    const { fake, world, render, engine } = setup();
    world.spawn(
      Transform,
      MeshRenderer.with({ geometry: new THREE.BoxGeometry(), material: new THREE.MeshBasicMaterial() }),
    );
    world.spawn(Transform, Light);
    expect(render.scene.children.length).toBe(2);
    engine.removePlugin('render');
    expect(render.scene.children.length).toBe(0);
    expect(fake.disposed).toBe(false); // 外部提供的繪製器不由外掛釋放
  });
});

describe('點選（射線檢測）', () => {
  test('回傳最近的實體與擊中點，可過濾', () => {
    const { clock, world, render } = setup();
    const cam = world.spawn(Transform, Camera.with({ fov: 60 }));
    world.get(cam, Transform)!.position.set(0, 0, 10); // 朝 -Z 看向原點
    const geo = new THREE.BoxGeometry(2, 2, 2);
    const mat = new THREE.MeshBasicMaterial();
    const near = world.spawn(Transform, MeshRenderer.with({ geometry: geo, material: mat }));
    world.get(near, Transform)!.position.set(0, 0, 2);
    const far = world.spawn(Transform, MeshRenderer.with({ geometry: geo, material: mat }));
    clock.frame(16);

    const hit = render.pick(0, 0)!;
    expect(hit.entity).toBe(near);
    expect(hit.distance).toBeCloseTo(7);
    expect(hit.normal!.toArray().map(Math.round)).toEqual([0, 0, 1]);
    // 射線穿過每個方塊的前後兩面，由近到遠排序
    expect(render.raycast(0, 0).map((h) => h.entity)).toEqual([near, near, far, far]);
    expect(render.pick(0, 0, (h) => h.entity !== near)!.entity).toBe(far);
    expect(render.pick(0.99, 0.99)).toBeNull();
  });

  test('spawn.grid 的格線不會被點到（不會擋住後面的物件）', () => {
    const { clock, world, render } = setup();
    const cam = world.spawn(Transform, Camera.with({ fov: 60 }));
    world.get(cam, Transform)!.position.set(0, 0, 10);
    // 格線在方塊前面、和射線幾乎貼著（線段射線偵測在 1 公尺內都算打到）
    spawn.grid(world, { size: 4, divisions: 4, position: [0, 0.3, 5] });
    const box = world.spawn(
      Transform,
      MeshRenderer.with({ geometry: new THREE.BoxGeometry(2, 2, 2), material: new THREE.MeshBasicMaterial() }),
    );
    clock.frame(16);
    expect(render.pick(0, 0)?.entity).toBe(box);
  });
});

describe('動態解析度只降低 3D 場景（畫布與介面維持清晰）', () => {
  test('變慢時：3D 的像素比降低，畫布的像素比不變；場景畫在較小的範圍再放大', () => {
    const clock = fakeScheduler();
    const ops: string[] = [];
    const pixelRatios: number[] = [];
    const renderer = {
      domElement: { parentElement: null, remove() {} },
      shadowMap: { enabled: false, type: 0 },
      getPixelRatio: () => 2,
      setPixelRatio: (v: number) => pixelRatios.push(v),
      setSize() {},
      setViewport: (_x: number, _y: number, w: number, h: number) =>
        ops.push(`viewport ${Math.round(w)}×${Math.round(h)}`),
      copyFramebufferToTexture: (t: THREE.FramebufferTexture) => ops.push(`copy ${t.image.width}×${t.image.height}`),
      render: (scene: THREE.Scene) =>
        ops.push(scene.children.length === 1 && (scene.children[0] as THREE.Mesh).isMesh ? 'upscale' : 'scene'),
      clear() {},
      dispose() {},
    } as unknown as THREE.WebGLRenderer;
    const ecs = new EcsPlugin();
    const render = new RenderPlugin({
      renderer,
      size: { width: 200, height: 100 },
      adaptiveResolution: { warmup: 0, minPixelRatio: 1 },
    });
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    engine.use(ecs).use(new ScenePlugin()).use(render);
    ecs.world.spawn(Transform, Camera);
    const resized: number[] = [];
    render.onResize(() => resized.push(render.pixelRatio));
    engine.start();
    for (let i = 0; i < 40 && render.renderScale === 1; i++) clock.frame(40); // 每幀 40ms：跟不上 60 FPS
    expect(render.renderScale).toBeLessThan(1);
    expect(render.pixelRatio).toBeCloseTo(2 * 0.85);
    expect(render.canvasPixelRatio).toBe(2);
    expect(pixelRatios).toHaveLength(1); // 只有安裝時設定一次，之後畫布解析度沒有被改
    expect(resized.at(-1)).toBeCloseTo(1.7); // 通知後製重新配置緩衝區
    ops.length = 0;
    clock.frame(16);
    expect(ops).toEqual(['viewport 170×85', 'scene', 'copy 340×170', 'viewport 200×100', 'upscale']);
  });
});
