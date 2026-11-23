import { afterEach, describe, expect, test, vi } from 'vitest';
import type * as THREE from 'three';
import { BoxGeometry } from 'three';
import { Engine } from '../src/core';
import { EcsPlugin, World, define, type Entity } from '../src/ecs';
import {
  Name,
  Parent,
  SceneCodecs,
  SceneCodecsKey,
  ScenePlugin,
  Transform,
  load,
  plainCodec,
  sceneFile,
  sceneFromFile,
  transformCodec,
  type SceneFileData,
} from '../src/scene';
import { Camera, Light, MeshRenderer, RenderPlugin } from '../src/render';
import { fakeScheduler } from './helpers';

function fakeRenderer() {
  return {
    domElement: { parentElement: null, remove() {} },
    shadowMap: { enabled: false, type: 0 },
    setPixelRatio() {},
    setSize() {},
    render() {},
    clear() {},
    dispose() {},
  } as unknown as import('three/webgpu').WebGPURenderer;
}

function setup() {
  const clock = fakeScheduler();
  const ecs = new EcsPlugin();
  const scene = new ScenePlugin();
  const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
  engine
    .use(ecs)
    .use(scene)
    .use(new RenderPlugin({ renderer: fakeRenderer(), size: { width: 200, height: 100 } }));
  engine.start();
  return { engine, world: ecs.world, scene };
}

const file = (entities: unknown[]): SceneFileData => ({ format: 'hero-scene', version: 1, entities }) as SceneFileData;

const round = (v: number[]) => v.map((n) => Math.round(n * 1e6) / 1e6 + 0);

afterEach(() => vi.unstubAllGlobals());

describe('場景檔格式檢查', () => {
  test('正確的檔案', () => {
    const data = sceneFile.parse(
      JSON.stringify(
        file([
          { id: 'a', name: '根' },
          { id: 'b', parent: 'a', components: { Transform: {} } },
        ]),
      ),
    );
    expect(data.entities.map((e) => e.id)).toEqual(['a', 'b']);
    expect(data.entities[1].parent).toBe('a');
  });

  test('錯誤訊息說明是哪裡錯', () => {
    expect(() => sceneFile.parse('{')).toThrow(/JSON/);
    expect(() => sceneFile.parse({ format: 'x', version: 1, entities: [] })).toThrow(/hero-scene/);
    expect(() => sceneFile.parse({ format: 'hero-scene', version: 99, entities: [] })).toThrow(/更新引擎/);
    expect(() => sceneFile.parse(file([{ id: 'a' }, { id: 'a' }]))).toThrow(/「a」重複/);
    expect(() => sceneFile.parse(file([{ name: 'x' }]))).toThrow(/entities\[0\] 缺少 id/);
    expect(() => sceneFile.parse(file([{ id: 'a', parent: 'zz' }]))).toThrow(/父節點「zz」不存在/);
    expect(() =>
      sceneFile.parse(
        file([
          { id: 'a', parent: 'b' },
          { id: 'b', parent: 'a' },
        ]),
      ),
    ).toThrow(/循環/);
  });
});

describe('讀檔：建立實體', () => {
  test('名稱、父子、Transform（角度用度）、繪製元件', () => {
    const { world } = setup();
    const spawned = sceneFile.spawn(
      world,
      file([
        { id: 'root', name: '根', components: { Transform: { position: [10, 0, 0], scale: [2, 2, 2] } } },
        {
          id: 'box',
          name: '箱子',
          parent: 'root',
          components: {
            Transform: { position: [1, 2, 3], rotation: [0, 90, 0] },
            MeshRenderer: { geometry: { box: 1 }, material: '#ff8800', castShadow: true },
          },
        },
        { id: 'cam', components: { Transform: { position: [0, 2, 6] }, Camera: { fov: 50 } } },
        { id: 'sun', components: { Light: { kind: 'spot', color: '#ff0000', angle: 45 } } },
      ]),
    );
    expect(spawned.warnings).toEqual([]);
    const box = spawned.entities.get('box')!;
    const root = spawned.entities.get('root')!;
    expect(world.get(box, Name)!.value).toBe('箱子');
    expect(world.get(box, Parent)!.entity).toBe(root);
    const t = world.get(box, Transform)!;
    expect(t.position.toArray()).toEqual([1, 2, 3]);
    // 繞 Y 轉 90 度
    expect(round(t.rotation.toArray())).toEqual(round([0, Math.SQRT1_2, 0, Math.SQRT1_2]));
    expect(world.get(box, MeshRenderer)).toMatchObject({ geometry: { box: 1 }, material: '#ff8800', castShadow: true });
    expect(world.get(spawned.entities.get('cam')!, Camera)!.fov).toBe(50);
    const light = world.get(spawned.entities.get('sun')!, Light)!;
    expect(light.kind).toBe('spot');
    expect(light.angle).toBeCloseTo(Math.PI / 4);
  });

  test('沒有登記的元件只警告；資料錯誤時不留下一半的實體', () => {
    const { world } = setup();
    const spawned = sceneFile.spawn(world, file([{ id: 'a', components: { Health: { hp: 3 } } }]));
    expect(spawned.warnings[0]).toMatch(/「a」.*Health.*略過/);

    const before = world.entityCount;
    expect(() =>
      sceneFile.spawn(
        world,
        file([
          { id: 'ok', components: { Transform: {} } },
          { id: 'bad', components: { Light: { kind: 'laser' } } },
        ]),
      ),
    ).toThrow(/實體「bad」的 Light：kind 只能是/);
    expect(world.entityCount).toBe(before);
    expect(() => sceneFile.spawn(world, file([{ id: 'x', components: { Transform: { position: [1, 2] } } }]))).toThrow(
      /position 要是三個數字/,
    );
    expect(() => sceneFile.spawn(world, file([{ id: 'x', components: { Camera: { fov: '50' } } }]))).toThrow(
      /fov 要是數字/,
    );
    expect(() => sceneFile.spawn(world, file([{ id: 'x', components: { Camera: { zoomz: 1 } } }]))).toThrow(
      /不認識的欄位「zoomz」/,
    );
  });

  test('沒有場景外掛時：傳入存讀規則，也能設定父子', () => {
    const world = new World();
    const codecs = new SceneCodecs();
    codecs.register(transformCodec);
    const s = sceneFile.spawn(world, file([{ id: 'a' }, { id: 'b', parent: 'a' }]), codecs);
    expect(world.get(s.entities.get('b')!, Parent)!.entity).toBe(s.entities.get('a'));
    expect(() => sceneFile.spawn(new World(), file([]))).toThrow(/ScenePlugin/);
  });
});

describe('存檔', () => {
  test('讀檔再存檔內容一樣（省略預設值、id 保留）', () => {
    const { world } = setup();
    const original = file([
      { id: 'root', name: '根', components: { Transform: { position: [10, 0, 0], rotation: [0, 90, 0] } } },
      {
        id: 'box',
        parent: 'root',
        components: {
          Transform: { scale: [2, 1, 1] },
          MeshRenderer: { geometry: { box: 1 }, material: { standard: { color: '#88ccff', roughness: 0.4 } } },
        },
      },
      { id: 'sun', components: { Transform: {}, Light: { color: '#ffeedd', intensity: 2, angle: 40 } } },
    ]);
    const spawned = sceneFile.spawn(world, original);
    const ids = new Map([...spawned.entities].map(([id, e]) => [e, id]));
    const written = sceneFile.write(world, [...spawned.entities.values()], { idOf: (e) => ids.get(e) });
    expect(written).toEqual(original);
    expect(sceneFile.stringify(written).endsWith('}\n')).toBe(true);
  });

  test('沒有 id 的依序編號；three.js 物件不能存，會警告', () => {
    const { world } = setup();
    const a = world.spawn(Transform, Name.with({ value: 'A' }));
    const b = world.spawn(Transform, MeshRenderer.with({ geometry: new BoxGeometry(), material: '#fff' }));
    world.requireResource(SceneCodecsKey); // 場景外掛建立了存讀規則
    const warn = vi.fn();
    const out = sceneFile.write(world, [a, b], { warn, idOf: (e) => (e === b ? 'e1' : undefined) });
    expect(out.entities.map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(out.entities[0]).toEqual({ id: 'e2', name: 'A', components: { Transform: {} } });
    expect(out.entities[1].components).toEqual({ Transform: {} });
    expect(warn.mock.calls[0][0]).toMatch(/MeshRenderer 不能存/);
  });

  test('父節點不在清單裡的存成最上層', () => {
    const { world, scene } = setup();
    const p = world.spawn(Transform);
    const c = world.spawn(Transform);
    scene.hierarchy.setParent(c, p);
    expect(sceneFile.write(world, [c]).entities[0].parent).toBeUndefined();
  });
});

describe('自訂元件與場景管理', () => {
  test('plainCodec：外掛登記自己的元件', () => {
    const { world, scene } = setup();
    const Health = define.component('Health', () => ({ max: 100, current: 100, alive: true }));
    scene.codecs.register(plainCodec(Health));
    const s = sceneFile.spawn(world, file([{ id: 'p', components: { Health: { current: 40 } } }]));
    expect(world.get(s.entities.get('p')!, Health)).toEqual({ max: 100, current: 40, alive: true });
    expect(sceneFile.write(world, [s.entities.get('p')!]).entities[0].components).toEqual({ Health: { current: 40 } });
    expect(() => plainCodec(define.component('V', () => ({ list: [] as number[] })))).toThrow(/skip/);
  });

  test('sceneFromFile：切換場景時移除實體；setup 拿得到建立的實體', () => {
    const { world, scene } = setup();
    let player: Entity | null = null;
    scene.scenes.register(
      sceneFromFile('forest', file([{ id: 'player', name: '玩家', components: { Transform: {} } }, { id: 'tree' }]), {
        setup: (_w, spawned) => {
          player = spawned.entities.get('player')!;
        },
      }),
      { name: 'empty', setup() {} },
    );
    scene.scenes.load('forest');
    expect(world.get(player!, Name)!.value).toBe('玩家');
    expect(world.entityCount).toBe(2);
    scene.scenes.load('empty');
    expect(world.entityCount).toBe(0);
  });

  test('load.sceneFile：下載並檢查', async () => {
    const body = JSON.stringify(file([{ id: 'a' }]));
    vi.stubGlobal('fetch', async (url: string) =>
      url === 'scenes/a.json'
        ? { ok: true, status: 200, text: async () => body }
        : { ok: false, status: 404, text: async () => '' },
    );
    expect((await load.sceneFile('scenes/a.json')).entities).toEqual([{ id: 'a' }]);
    await expect(load.sceneFile('scenes/b.json')).rejects.toThrow(/404/);
  });

  test('解除安裝繪製外掛後，繪製元件的存讀規則一併移除', () => {
    const { engine, world } = setup();
    const codecs = world.requireResource(SceneCodecsKey);
    expect(codecs.get('MeshRenderer')).toBeDefined();
    engine.removePlugin('render');
    expect(codecs.get('MeshRenderer')).toBeUndefined();
    // 同名登記兩次：取消後面那個時恢復前一個
    const a = { ...transformCodec };
    const b = { ...transformCodec };
    const offA = codecs.register(a);
    const offB = codecs.register(b);
    expect(codecs.get('Transform')).toBe(b);
    offB();
    expect(codecs.get('Transform')).toBe(a);
    offA();
    offA();
    expect(codecs.get('Transform')).toBe(transformCodec);
    expect(codecs.get('Transform')).toBeDefined();
  });
});

describe('plainCodec：可以是 null、{ x, y, z }', () => {
  test('nullable 與 triples', () => {
    const C = define.component('Mover', () => ({
      target: null as string | null,
      axis: { x: 0, y: 1, z: 0 },
      lock: { x: false, y: false, z: false },
    }));
    const codec = plainCodec(C, { nullable: ['target'], triples: ['axis', 'lock'] });
    const ctx = { entity: 'e', component: 'Mover', warn() {} };
    expect(codec.read({ target: 'a', axis: [1, 0, 0], lock: [true, false, false] }, ctx)).toEqual({
      target: 'a',
      axis: { x: 1, y: 0, z: 0 },
      lock: { x: true, y: false, z: false },
    });
    expect(codec.read({ target: null }, ctx)).toEqual({ target: null });
    expect(() => codec.read({ axis: [1, 0] }, ctx)).toThrow(/三個數字/);
    expect(() => codec.read({ lock: [1, 0, 0] }, ctx)).toThrow(/三個true 或 false/);
    expect(() => codec.read({ target: 3 }, ctx)).toThrow(/文字或 null/);
    expect(codec.write({ target: null, axis: { x: 0, y: 1, z: 0 }, lock: { x: false, y: true, z: false } })).toEqual({
      lock: [false, true, false],
    });
  });
});

describe('預製物件', () => {
  const tree: SceneFileData = file([
    { id: 'root', name: '樹', components: { Transform: { scale: [2, 2, 2] }, Camera: { fov: 30 } } },
    { id: 'leaf', parent: 'root', components: { Transform: { position: [0, 1, 0] } } },
  ]);

  test('展開：id、名稱、父節點、元件覆蓋', () => {
    const data = file([
      { id: 'group' },
      { id: 't1', parent: 'group', prefab: 'prefabs/tree.json', components: { Transform: { position: [5, 0, 0] } } },
      { id: 'bird', parent: 't1' },
    ]);
    data.prefabs = { 'prefabs/tree.json': tree };
    const out = sceneFile.expandPrefabs(data).data.entities;
    expect(out).toEqual([
      { id: 'group' },
      {
        id: 't1',
        name: '樹',
        parent: 'group',
        components: { Transform: { position: [5, 0, 0] }, Camera: { fov: 30 } },
      },
      { id: 't1/leaf', parent: 't1', components: { Transform: { position: [0, 1, 0] } } },
      { id: 'bird', parent: 't1' },
    ]);
  });

  test('預製物件裡再用預製物件；不能包含自己；找不到時的處理', () => {
    const forest = file([{ id: 'f' }, { id: 'a', parent: 'f', prefab: 'tree' }]);
    const data = file([{ id: 'x', prefab: 'forest', name: '森林' }]);
    data.prefabs = { tree, forest };
    expect(sceneFile.expandPrefabs(data).data.entities.map((e) => `${e.id}<${e.parent ?? ''}`)).toEqual([
      'x<',
      'x/a<x',
      'x/a/leaf<x/a',
    ]);
    data.prefabs.tree = file([{ id: 'r', prefab: 'forest' }]);
    expect(() => sceneFile.expandPrefabs(data)).toThrow(/包含了自己/);
    const lonely = file([{ id: 'x', prefab: 'nope' }]);
    expect(() => sceneFile.expandPrefabs(lonely)).toThrow(/沒有載入/);
    expect(sceneFile.expandPrefabs(lonely, { missing: 'skip' })).toEqual({
      data: file([{ id: 'x' }]),
      missing: ['nope'],
      warnings: [],
    });
    expect(() => sceneFile.parse(file([{ id: 'a/b' }]))).toThrow(/不能有 \//);
    const twoRoots = file([{ id: 'x', prefab: 'p' }]);
    twoRoots.prefabs = { p: file([{ id: 'a' }, { id: 'b' }]) };
    expect(() => sceneFile.expandPrefabs(twoRoots)).toThrow(/剛好有一個最上層/);
  });

  test('load.sceneFile 下載用到的預製物件（包含預製物件裡的），spawn 時展開；存成文字時不寫出', async () => {
    const files: Record<string, unknown> = {
      'scenes/a.json': file([{ id: 't', prefab: 'prefabs/forest.json' }]),
      'prefabs/forest.json': file([{ id: 'f' }, { id: 'a', parent: 'f', prefab: 'prefabs/tree.json' }]),
      'prefabs/tree.json': tree,
    };
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return { ok: url in files, status: url in files ? 200 : 404, text: async () => JSON.stringify(files[url]) };
    });
    const data = await load.sceneFile('scenes/a.json');
    expect(fetched).toEqual(['scenes/a.json', 'prefabs/forest.json', 'prefabs/tree.json']);
    const { world } = setup();
    const spawned = sceneFile.spawn(world, data);
    expect([...spawned.entities.keys()]).toEqual(['t', 't/a', 't/a/leaf']);
    expect(world.get(spawned.entities.get('t/a')!, Camera)!.fov).toBe(30);
    expect(JSON.parse(sceneFile.stringify(data)).prefabs).toBeUndefined();
  });
});

describe('各外掛登記的存讀規則', () => {
  test('Model、Animator（AssetPlugin、AnimationPlugin）', async () => {
    const { AssetPlugin, Model } = await import('../src/assets');
    const { AnimationPlugin, Animator } = await import('../src/animation');
    const { engine, world } = setup();
    engine.use(new AssetPlugin()).use(new AnimationPlugin());
    const s = sceneFile.spawn(
      world,
      file([
        {
          id: 'm',
          components: { Model: { url: 'models/a.glb', castShadow: true }, Animator: { play: 'Walk', speed: 2 } },
        },
      ]),
    );
    const e = s.entities.get('m')!;
    expect(world.get(e, Model)).toMatchObject({ url: 'models/a.glb', castShadow: true });
    expect(world.get(e, Animator)).toMatchObject({ play: 'Walk', speed: 2, loop: true });
    expect(sceneFile.write(world, [e]).entities[0].components).toEqual({
      Model: { url: 'models/a.glb', castShadow: true },
      Animator: { play: 'Walk', speed: 2 },
    });
    engine.removePlugin('animation').removePlugin('assets');
    expect(world.requireResource(SceneCodecsKey).get('Model')).toBeUndefined();
  });

  test('RigidBody、Collider 的存讀規則', async () => {
    const { rigidBodyCodec, colliderCodec } = await import('../src/physics/sceneCodecs');
    const ctx = { entity: 'e', component: 'x', warn() {} };
    expect(rigidBodyCodec.read({ type: 'fixed', rotations: [false, true, false] }, ctx)).toEqual({
      type: 'fixed',
      rotations: { x: false, y: true, z: false },
    });
    expect(() => rigidBodyCodec.read({ type: 'ghost' }, ctx)).toThrow(/只能是/);
    const collider = {
      ...colliderCodec.type.create(),
      ...colliderCodec.read({ halfExtents: [1, 0.25, 1], friction: 0.9 }, ctx),
    };
    expect(colliderCodec.write(collider)).toEqual({ halfExtents: [1, 0.25, 1], friction: 0.9 });
  });
});

describe('粒子、音效的存讀規則', () => {
  const ctx = { entity: 'e', component: 'x', warn() {} };

  test('ParticleEmitter：範圍、角度用度、duration、預設值省略', async () => {
    const { particleEmitterCodec, ParticleEmitter, ParticlePresets } = await import('../src/particles');
    const read = particleEmitterCodec.read(
      {
        rate: 5,
        lifetime: [1, 3],
        rotation: [0, 360],
        spread: 90,
        duration: 2,
        color: '#ff0000',
        direction: [1, 0, 0],
      },
      ctx,
    );
    expect(read).toMatchObject({
      rate: 5,
      lifetime: [1, 3],
      duration: 2,
      color: '#ff0000',
      direction: { x: 1, y: 0, z: 0 },
    });
    expect(read.spread).toBeCloseTo(Math.PI / 2);
    expect((read.rotation as readonly number[])[1]).toBeCloseTo(Math.PI * 2);
    expect(particleEmitterCodec.read({ duration: null }, ctx).duration).toBe(Infinity);
    expect(() => particleEmitterCodec.read({ size: [1] }, ctx)).toThrow(/數字或 \[最小, 最大\]/);
    expect(() => particleEmitterCodec.read({ duration: -1 }, ctx)).toThrow(/duration/);
    // 預設值存檔是空物件；預設特效存檔再讀回來一樣
    expect(particleEmitterCodec.write(ParticleEmitter.create())).toEqual({});
    const fire = { ...ParticleEmitter.create(), ...ParticlePresets.fire() };
    const file = particleEmitterCodec.write(fire) as Record<string, unknown>;
    expect(file).toMatchObject({ rate: 60, lifetime: [0.5, 1], color: '#ffd36b', shape: 'circle' });
    const back = { ...ParticleEmitter.create(), ...particleEmitterCodec.read(file, ctx) };
    expect(particleEmitterCodec.write(back)).toEqual(file);
  });

  test('AudioSource', async () => {
    const { audioSourceCodec, AudioSource } = await import('../src/audio');
    const v = {
      ...AudioSource.create(),
      ...audioSourceCodec.read({ url: 'sounds/fire.mp3', loop: true, playing: true }, ctx),
    };
    expect(audioSourceCodec.write(v)).toEqual({ url: 'sounds/fire.mp3', loop: true, playing: true });
  });
});

describe('開發時自動重新載入', () => {
  test('場景檔或用到的預製物件改了：重新下載、重新載入場景', async () => {
    const files: Record<string, unknown> = {
      'scenes/a.json': file([{ id: 'x', name: '一', prefab: 'prefabs/p.json' }]),
      'prefabs/p.json': file([{ id: 'r', components: { Camera: { fov: 30 } } }]),
    };
    vi.stubGlobal('fetch', async (url: string) => ({
      ok: url in files,
      status: 200,
      text: async () => JSON.stringify(files[url]),
    }));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { world, scene } = setup();
    const data = await load.sceneFile('scenes/a.json');
    scene.scenes.register(sceneFromFile('a', data), sceneFromFile('b', data, { hotReload: false }));
    scene.scenes.load('a');
    const nameOf = () => world.query([Name]).entities.map((e) => world.get(e, Name)!.value);
    const fov = () => world.query([Camera]).entities.map((e) => world.get(e, Camera)!.fov);
    expect(nameOf()).toEqual(['一']);

    const settle = () => new Promise((r) => setTimeout(r, 10));
    files['scenes/a.json'] = file([{ id: 'x', name: '二', prefab: 'prefabs/p.json' }]);
    sceneFile.notifyChanged('/scenes/a.json');
    await settle();
    expect(nameOf()).toEqual(['二']);

    files['prefabs/p.json'] = file([{ id: 'r', components: { Camera: { fov: 45 } } }]);
    sceneFile.notifyChanged('prefabs/p.json');
    await settle();
    expect(fov()).toEqual([45]);

    // 無關的檔案不影響；沒有載入的場景只更新資料
    sceneFile.notifyChanged('scenes/other.json');
    scene.scenes.load('b');
    expect(world.query([Name]).entities).toHaveLength(1);
    expect(info).toHaveBeenCalledTimes(2);
    info.mockRestore();
  });
});

describe('預製物件內部覆蓋', () => {
  test('覆蓋名稱、取代元件、移除元件；對不到的覆蓋只警告', () => {
    const data = file([
      {
        id: 't',
        prefab: 'tree',
        overrides: {
          leaf: { name: '紅葉', components: { Camera: { fov: 20 }, Transform: null } },
          'sub/x': { name: '巢狀' },
          gone: { name: '?' },
        },
      },
    ]);
    data.prefabs = {
      tree: file([
        { id: 'root' },
        { id: 'leaf', parent: 'root', components: { Transform: { position: [0, 1, 0] } } },
        { id: 'sub', parent: 'root', prefab: 'inner' },
      ]),
      inner: file([{ id: 'r' }, { id: 'x', parent: 'r' }]),
    };
    const out = sceneFile.expandPrefabs(data);
    expect(out.data.entities.find((e) => e.id === 't/leaf')).toEqual({
      id: 't/leaf',
      parent: 't',
      name: '紅葉',
      components: { Camera: { fov: 20 } },
    });
    expect(out.data.entities.find((e) => e.id === 't/sub/x')!.name).toBe('巢狀');
    expect(out.warnings).toEqual([expect.stringMatching(/覆蓋「gone」.*找不到/)]);
    expect(() => sceneFile.parse(file([{ id: 'a', overrides: {} }]))).toThrow(/不是預製物件的實例/);
    expect(() => sceneFile.parse(file([{ id: 'a', prefab: 'p', overrides: { x: 1 } }]))).toThrow(/overrides\.x/);
  });
});

describe('場景設定', () => {
  test('背景、霧：套用與恢復；沒有處理方式的鍵只警告；錯誤時恢復已套用的', async () => {
    const { applySceneSettings } = await import('../src/scene');
    const { world, engine } = setup();
    const render = engine.getPlugin<RenderPlugin>('render')!;
    const before = render.scene.background;
    const r = applySceneSettings(world, {
      background: '#223344',
      fog: { color: '#ffffff', near: 5, far: 50 },
      weather: 'rain',
    });
    expect((render.scene.background as THREE.Color).getHexString()).toBe('223344');
    expect(render.scene.fog).toMatchObject({ near: 5, far: 50 });
    expect(r.warnings).toEqual([expect.stringMatching(/weather.*沒有對應的外掛/)]);
    r.undo();
    expect(render.scene.background).toBe(before);
    expect(render.scene.fog).toBeNull();
    expect(() => applySceneSettings(world, { background: '#000000', fog: { color: '#fff', far: -1 } })).toThrow(
      /fog：far 要是 0 以上/,
    );
    expect(render.scene.background).toBe(before);
  });

  test('sceneFromFile：載入時套用、切換場景時恢復；後製只改寫到的欄位', async () => {
    const { PostProcessingPlugin } = await import('../src/postfx');
    const { world, engine, scene } = setup();
    const postfx = new PostProcessingPlugin();
    engine.use(postfx);
    const data = file([{ id: 'a' }]);
    data.settings = { postfx: { exposure: 2, bloom: { enabled: true } } };
    scene.scenes.register(sceneFromFile('s', data), { name: 'empty', setup() {} });
    scene.scenes.load('s');
    expect(postfx.settings.exposure).toBe(2);
    expect(postfx.settings.bloom).toMatchObject({ enabled: true, strength: 0.6 });
    scene.scenes.load('empty');
    expect(postfx.settings.exposure).toBe(1);
    expect(postfx.settings.bloom.enabled).toBe(false);
    const { applySceneSettings } = await import('../src/scene');
    expect(() => applySceneSettings(world, { postfx: { bloom: { glow: 1 } } })).toThrow(/bloom\.glow/);
    expect(() => applySceneSettings(world, { postfx: { exposure: 'high' } })).toThrow(/型別不對/);
  });

  test('導航網格：可走格數的編碼、檔案 ↔ NavGrid、AI 外掛套用與恢復', async () => {
    const { AIPlugin, NavGrid, encodeWalkable, decodeWalkable, navGridFromFile, navGridToFile } = await import(
      '../src/ai'
    );
    expect(encodeWalkable([1, 1, 0, 0, 0, 1])).toEqual([2, 3, 1]);
    expect(encodeWalkable([0, 1])).toEqual([0, 1, 1]);
    expect([...decodeWalkable([0, 1, 1], 3)]).toEqual([0, 1, 1]);
    const grid = new NavGrid({ min: { x: -2, z: -1 }, max: { x: 2, z: 1 }, cellSize: 1 });
    grid.setWalkable(1, 0, false);
    const f = navGridToFile(grid);
    expect(f).toEqual({ min: [-2, -1], max: [2, 1], cellSize: 1, walkable: [1, 1, 6] });
    const back = navGridFromFile(f);
    expect([...back.walkable]).toEqual([...grid.walkable]);
    expect(() => navGridFromFile({ min: [0, 0], max: [0, 1] })).toThrow(/max 要比 min 大/);

    const { world, engine } = setup();
    const ai = new AIPlugin();
    engine.use(ai);
    const { applySceneSettings } = await import('../src/scene');
    const r = applySceneSettings(world, { navGrid: f });
    expect(ai.navGrid?.cols).toBe(4);
    expect(ai.navGrid?.isWalkable({ x: -0.5, z: -0.5 })).toBe(false);
    r.undo();
    expect(ai.navGrid).toBeNull();
  });
});
