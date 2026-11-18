import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { ScenePlugin, Transform } from '../src/scene';
import { Camera, Light, MeshRenderer, RenderPlugin, create, spawn } from '../src/render';
import { Collider, PhysicsPlugin, load } from '../src/physics';
import * as hero from '../src';
import { RenderResources, SceneObject } from '../src/render';
import { ShaderLibrary } from '../src/shaders';
import * as core from '../src/core';
import { fakeScheduler } from './helpers';

function fakeRenderer() {
  return {
    domElement: { parentElement: null, remove() {} },
    shadowMap: { enabled: false, type: 0 },
    setPixelRatio() {},
    getPixelRatio: () => 1,
    setSize() {},
    render() {},
    clear() {},
    dispose() {},
  } as unknown as THREE.WebGLRenderer;
}

function setup() {
  const clock = fakeScheduler();
  const ecs = new EcsPlugin();
  const render = new RenderPlugin({ renderer: fakeRenderer(), size: { width: 200, height: 100 } });
  const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
  engine.use(ecs).use(new ScenePlugin()).use(render);
  engine.start();
  return { clock, world: ecs.world, render, frame: () => clock.frame(16) };
}

const meshOf = (render: RenderPlugin, e: number) => render.getObject(e as never) as THREE.Mesh;

describe('幾何、材質描述', () => {
  test('建立對應的 three.js 物件與尺寸', () => {
    const box = create.geometry({ box: [1, 2, 3] }) as THREE.BoxGeometry;
    expect(box).toBeInstanceOf(THREE.BoxGeometry);
    expect([box.parameters.width, box.parameters.height, box.parameters.depth]).toEqual([1, 2, 3]);
    expect((create.geometry({ box: 2 }) as THREE.BoxGeometry).parameters.depth).toBe(2);
    expect((create.geometry({ sphere: 0.5 }) as THREE.SphereGeometry).parameters.radius).toBe(0.5);
    expect(create.geometry({ plane: [4, 2] })).toBeInstanceOf(THREE.PlaneGeometry);
    expect(create.geometry({ capsule: [0.3, 1] })).toBeInstanceOf(THREE.CapsuleGeometry);
    expect(() => create.geometry({ cube: 1 } as never)).toThrow('可用：box');
  });

  test('材質：顏色簡寫、side 名稱、各種種類', () => {
    const m = create.material('#ff0000') as THREE.MeshStandardMaterial;
    expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(m.color.getHexString()).toBe('ff0000');
    const b = create.material({
      basic: { color: 0x00ff00, side: 'double', transparent: true, opacity: 0.5 },
    }) as THREE.MeshBasicMaterial;
    expect(b).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(b.side).toBe(THREE.DoubleSide);
    expect(b.opacity).toBe(0.5);
    expect(create.material({ physical: { clearcoat: 1 } })).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  });
});

describe('MeshRenderer 使用描述', () => {
  test('內容一樣的描述共用同一份（鍵的順序不影響）', () => {
    const { world, render, frame } = setup();
    const a = spawn.mesh(world, { geometry: { box: 1 }, material: { standard: { color: '#f80', roughness: 0.4 } } });
    const b = spawn.mesh(world, { geometry: { box: 1 }, material: { standard: { roughness: 0.4, color: '#f80' } } });
    const c = spawn.mesh(world, { geometry: { box: 2 }, material: '#f80' });
    frame();
    expect(meshOf(render, a).geometry).toBe(meshOf(render, b).geometry);
    expect(meshOf(render, a).material).toBe(meshOf(render, b).material);
    expect(meshOf(render, c).geometry).not.toBe(meshOf(render, a).geometry);
    expect(render.resources.stats).toEqual({ geometries: 2, materials: 2, textures: 0 });
  });

  test('沒有實體在用時自動釋放（dispose）', () => {
    const { world, render, frame } = setup();
    const a = spawn.mesh(world, { geometry: { sphere: 1 }, material: '#123456' });
    const b = spawn.mesh(world, { geometry: { sphere: 1 }, material: '#123456' });
    frame();
    let disposed = 0;
    meshOf(render, a).geometry.addEventListener('dispose', () => disposed++);
    (meshOf(render, a).material as THREE.Material).addEventListener('dispose', () => disposed++);
    world.destroy(a);
    frame();
    expect(disposed).toBe(0); // b 還在用
    world.destroy(b);
    frame();
    expect(disposed).toBe(2);
    expect(render.resources.stats).toEqual({ geometries: 0, materials: 0, textures: 0 });
  });

  test('同一幀裡先刪後建（換場景）：直接重用，不會釋放再建立', () => {
    const { world, render, frame } = setup();
    const a = spawn.mesh(world, { geometry: { box: 1 }, material: '#abcdef' });
    frame();
    const material = meshOf(render, a).material as THREE.Material;
    let disposed = false;
    material.addEventListener('dispose', () => (disposed = true));
    world.destroy(a);
    const b = spawn.mesh(world, { geometry: { box: 1 }, material: '#abcdef' });
    frame();
    expect(disposed).toBe(false);
    expect(meshOf(render, b).material).toBe(material);
  });

  test('換描述：改用新的，舊的沒人用就釋放', () => {
    const { world, render, frame } = setup();
    const e = spawn.mesh(world, { geometry: { box: 1 }, material: '#111111' });
    frame();
    world.require(e, MeshRenderer).material = '#222222';
    frame();
    expect((meshOf(render, e).material as THREE.MeshStandardMaterial).color.getHexString()).toBe('222222');
    expect(render.resources.stats.materials).toBe(1);
  });

  test('直接給 three.js 物件：照常使用，不會被自動釋放', () => {
    const { world, render, frame } = setup();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    let disposed = false;
    material.addEventListener('dispose', () => (disposed = true));
    const e = world.spawn(Transform, MeshRenderer.with({ geometry, material }));
    frame();
    expect(meshOf(render, e).geometry).toBe(geometry);
    world.destroy(e);
    frame();
    expect(disposed).toBe(false);
    expect(render.resources.stats).toEqual({ geometries: 0, materials: 0, textures: 0 });
  });
});

describe('建立實體的小工具', () => {
  test('spawn.camera：位置與朝向（-Z 對準目標）', () => {
    const { world } = setup();
    const cam = spawn.camera(world, { position: [0, 0, 5], target: [0, 0, 0], fov: 40 });
    expect(world.require(cam, Camera).fov).toBe(40);
    const t = world.require(cam, Transform);
    expect(t.position.toArray()).toEqual([0, 0, 5]);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(t.rotation);
    expect(forward.z).toBeCloseTo(-1);
  });

  test('spawn.defaultLights：半球光 + 平行光', () => {
    const { world } = setup();
    const { ambient, sun } = spawn.defaultLights(world, { intensity: 2, shadows: true });
    expect(world.require(ambient, Light).kind).toBe('hemisphere');
    expect(world.require(sun, Light).kind).toBe('directional');
    expect(world.require(sun, Light).intensity).toBe(4);
    expect(world.require(sun, Light).castShadow).toBe(true);
  });

  test('半球光：沒有指定位置時天空在正上方（three.js 用位置當作天空的方向）', () => {
    const { world, render, frame } = setup();
    const { ambient } = spawn.defaultLights(world);
    frame();
    const light = render.getObject(ambient, 'light') as THREE.HemisphereLight;
    light.updateMatrixWorld();
    expect(new THREE.Vector3().setFromMatrixPosition(light.matrixWorld).toArray()).toEqual([0, 1, 0]);
  });

  test('spawn.mesh：位置、旋轉、縮放', () => {
    const { world } = setup();
    const e = spawn.mesh(world, {
      geometry: { plane: 10 },
      material: '#333',
      position: [1, 2, 3],
      rotation: [-Math.PI / 2, 0, 0],
      scale: 2,
    });
    const t = world.require(e, Transform);
    expect(t.position.toArray()).toEqual([1, 2, 3]);
    expect(t.scale.toArray()).toEqual([2, 2, 2]);
    const up = new THREE.Vector3(0, 0, 1).applyQuaternion(t.rotation); // 平面的正面朝上
    expect(up.y).toBeCloseTo(1);
  });
});

describe('spawn 分組寫法', () => {
  test('只有分類寫法：hero.spawn.camera 等；沒有分類的舊名稱已經移除', () => {
    expect(Object.keys(spawn).sort()).toEqual(['camera', 'defaultLights', 'entity', 'grid', 'light', 'mesh']);
    expect(hero.spawn).toBe(spawn);
    for (const old of ['spawnCamera', 'spawnLight', 'spawnMesh', 'spawnDefaultLights']) expect(old in hero).toBe(false);
  });

  test('回傳建立的實體，可以接住再加元件', () => {
    const { world } = setup();
    const camera = spawn.camera(world, { position: [0, 4, 9], target: [0, 0.5, 0], fov: 45 });
    expect(world.require(camera, Camera).fov).toBe(45);
    expect(world.require(camera, Transform).position.toArray()).toEqual([0, 4, 9]);
  });
});

describe('物理：網格用描述時也能建立 convexHull 碰撞體', () => {
  beforeAll(async () => {
    await load.rapier();
  });

  test('用 { box } 描述的網格建立凸包碰撞體', async () => {
    const clock = fakeScheduler();
    const ecs = new EcsPlugin();
    const physicsPlugin = await PhysicsPlugin.create();
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    // 網格的幾何由繪製外掛提供（物理不直接依賴繪製模組）
    engine
      .use(ecs)
      .use(new ScenePlugin())
      .use(new RenderPlugin({ renderer: fakeRenderer(), size: { width: 10, height: 10 } }))
      .use(physicsPlugin);
    engine.start();
    const e = ecs.world.spawn(
      Transform,
      MeshRenderer.with({ geometry: { box: 2 } }),
      Collider.with({ shape: 'convexHull' }),
    );
    for (let i = 0; i < 5; i++) clock.frame(20); // 物理以固定步長（1/60 秒）執行
    expect(physicsPlugin.physics.colliderOf(e)).toBeDefined();
  });

  test('沒有繪製外掛時：網格的幾何拿不到，不建立碰撞體（也不會出錯）', async () => {
    const clock = fakeScheduler();
    const ecs = new EcsPlugin();
    const physicsPlugin = await PhysicsPlugin.create();
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    engine.use(ecs).use(new ScenePlugin()).use(physicsPlugin);
    engine.start();
    const e = ecs.world.spawn(
      Transform,
      MeshRenderer.with({ geometry: { box: 2 } }),
      Collider.with({ shape: 'convexHull' }),
    );
    for (let i = 0; i < 5; i++) clock.frame(20);
    expect(physicsPlugin.physics.colliderOf(e)).toBeUndefined();
  });
});

describe('總入口 @engine', () => {
  test('各模組的 API 都在，而且是同一個東西', () => {
    expect(hero.Engine).toBe(core.Engine);
    expect(typeof hero.spawn.camera).toBe('function');
    expect(typeof hero.UI2D).toBe('function');
    expect(typeof hero.PhysicsPlugin).toBe('function');
    expect(hero.Binding).toBeDefined(); // 名稱重複的 Binding 指的是繪製的綁定類別
  });
});

describe('描述的進階寫法（不需要 import three）', () => {
  test('幾何：rotation 先轉、offset 再移；平面分段；正多面體', () => {
    const coin = create.geometry({ cylinder: [0.3, 0.06], rotation: [Math.PI / 2, 0, 0] });
    coin.computeBoundingBox();
    expect(coin.boundingBox!.max.z).toBeCloseTo(0.03, 5); // 高度方向轉到 Z
    const box = create.geometry({ box: 1, offset: [0, 0.5, 0] });
    box.computeBoundingBox();
    expect([box.boundingBox!.min.y, box.boundingBox!.max.y]).toEqual([0, 1]); // 以底部為中心
    const plane = create.geometry({ plane: [4, 2, 8, 4] }) as THREE.PlaneGeometry;
    expect([plane.parameters.widthSegments, plane.parameters.heightSegments]).toEqual([8, 4]);
    expect(create.geometry({ dodecahedron: 0.5 })).toBeInstanceOf(THREE.DodecahedronGeometry);
  });

  test('材質：side、blending 寫名稱；create.material 回傳對應的類別（型別也是）', () => {
    const m = create.material({ basic: { color: '#fff', side: 'double', blending: 'additive', transparent: true } });
    expect(m).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect([m.side, m.blending]).toEqual([THREE.DoubleSide, THREE.AdditiveBlending]);
    const s = create.material({ standard: { color: '#f00' } });
    s.emissive.set('#00f'); // 型別是 MeshStandardMaterial：可以直接用 emissive
    expect(s.emissive.getHexString()).toBe('0000ff');
  });

  test('貼圖寫網址：自動載入、套用重複與色彩空間；同樣的設定共用一張，材質都釋放後才釋放', () => {
    const loaded: string[] = [];
    const resources = new RenderResources((url, options) => {
      loaded.push(url);
      const t = new THREE.Texture();
      if (options.colorSpace === 'srgb') t.colorSpace = THREE.SRGBColorSpace;
      if (options.repeat) t.repeat.set(options.repeat[0], options.repeat[1]);
      return t;
    });
    const a = resources.acquireMaterial({ standard: { map: 'checker.png', repeat: 10 } });
    const b = resources.acquireMaterial({ standard: { map: 'checker.png', repeat: 10, roughness: 0.5 } });
    const c = resources.acquireMaterial({ standard: { map: 'checker.png', repeat: 2 } });
    const map = (a.value as THREE.MeshStandardMaterial).map!;
    expect(map.repeat.x).toBe(10);
    expect(map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect((b.value as THREE.MeshStandardMaterial).map).toBe(map); // 不同材質、同樣的貼圖設定：共用
    expect((c.value as THREE.MeshStandardMaterial).map).not.toBe(map); // 重複次數不同：另一張
    expect(loaded).toEqual(['checker.png', 'checker.png']);
    expect(resources.stats.textures).toBe(2);
    let disposed = false;
    map.addEventListener('dispose', () => (disposed = true));
    resources.release(a.key);
    resources.sweep();
    expect(disposed).toBe(false); // b 還在用
    resources.release(b.key);
    resources.sweep();
    expect(disposed).toBe(true);
    expect(resources.stats).toEqual({ geometries: 0, materials: 1, textures: 1 });
  });

  test('spawn.grid：地面格線', () => {
    const { world } = setup();
    const e = spawn.grid(world, { size: 8, divisions: 4, position: [0, -1, 0] });
    expect(world.require(e, SceneObject).object).toBeInstanceOf(THREE.GridHelper);
    expect(world.require(e, Transform).position.y).toBe(-1);
  });

  test('自訂著色器的材質參數也可以寫名稱（side: double、blending: additive）', () => {
    const lib = new ShaderLibrary();
    lib.define({
      name: 'glow',
      base: 'unlit',
      options: { blending: 'additive', side: 'double' },
      fragment: 'color = vec4(1.0);',
    });
    const m = lib.createMaterial('glow');
    expect([m.blending, m.side]).toEqual([THREE.AdditiveBlending, THREE.DoubleSide]);
  });
});
