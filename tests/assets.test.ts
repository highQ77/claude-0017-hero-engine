/// <reference types="vite/client" />
import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { ScenePlugin, Transform } from '../src/scene';
import { SceneObject } from '../src/render';
import { AssetManager, AssetPlugin, Model, object3d, type AssetLoader, type GLTF } from '../src/assets';
import { fakeScheduler } from './helpers';

/** 可手動控制完成時機的載入器 */
function controllableLoader<T>(extensions: string[], make: (url: string) => T) {
  const pending = new Map<string, { resolve: (v: T) => void; reject: (e: Error) => void }>();
  const disposed: T[] = [];
  let calls = 0;
  const loader: AssetLoader<T> = {
    extensions,
    load(url) {
      calls++;
      return new Promise<T>((resolve, reject) => pending.set(url, { resolve, reject }));
    },
    dispose: (asset) => disposed.push(asset),
  };
  return {
    loader,
    disposed,
    get calls() {
      return calls;
    },
    resolve(url: string) {
      pending.get(url)!.resolve(make(url));
      pending.delete(url);
    },
    reject(url: string, message = 'boom') {
      pending.get(url)!.reject(new Error(message));
      pending.delete(url);
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('AssetManager', () => {
  test('同網址只載入一次、參考計數歸零才釋放', async () => {
    const m = new AssetManager();
    const fake = controllableLoader(['.fake'], (url) => ({ url }));
    m.registerLoader('fake', fake.loader);
    const p1 = m.load('a.fake');
    const p2 = m.load('a.fake');
    await tick();
    expect(fake.calls).toBe(1);
    expect(m.refCount('a.fake')).toBe(2);
    expect(m.get('a.fake')).toBeUndefined();
    fake.resolve('a.fake');
    expect(await p1).toBe(await p2);
    expect(m.get('a.fake')).toEqual({ url: 'a.fake' });

    m.release('a.fake');
    expect(fake.disposed).toHaveLength(0);
    m.release('a.fake');
    expect(fake.disposed).toHaveLength(1);
    expect(m.isLoaded('a.fake')).toBe(false);
    m.release('a.fake'); // 多放一次不出錯
  });

  test('載入中就全部釋放：完成後立刻釋放', async () => {
    const m = new AssetManager();
    const fake = controllableLoader(['.fake'], (url) => ({ url }));
    m.registerLoader('fake', fake.loader);
    const p = m.load('b.fake');
    m.release('b.fake');
    await tick();
    fake.resolve('b.fake');
    await p;
    expect(fake.disposed).toHaveLength(1);
    expect(m.isLoaded('b.fake')).toBe(false);
  });

  test('失敗不留在快取，可以重試', async () => {
    const m = new AssetManager();
    const fake = controllableLoader(['.fake'], (url) => ({ url }));
    m.registerLoader('fake', fake.loader);
    const p = m.load('c.fake');
    await tick();
    fake.reject('c.fake', '404');
    await expect(p).rejects.toThrow(/載入失敗：c\.fake（404）/);
    expect(m.refCount('c.fake')).toBe(0);
    const retry = m.load('c.fake');
    await tick();
    expect(fake.calls).toBe(2);
    fake.resolve('c.fake');
    await expect(retry).resolves.toEqual({ url: 'c.fake' });
  });

  test('類型判斷（多段副檔名優先、忽略查詢字串）與基礎路徑', () => {
    const m = new AssetManager({ baseUrl: '/assets' });
    const noop = { load: async () => null as never };
    m.registerLoader('json', { extensions: ['.json'], ...noop });
    m.registerLoader('font', { extensions: ['.typeface.json'], ...noop });
    m.registerLoader('texture', { extensions: ['.png'], ...noop });
    expect(m.resolveType('a/b.json')).toBe('json');
    expect(m.resolveType('fonts/Noto.typeface.json')).toBe('font');
    expect(m.resolveType('x/WALL.PNG?v=3#a')).toBe('texture');
    expect(() => m.resolveType('x.unknown')).toThrow(/無法判斷/);
    expect(m.resolveUrl('models/a.glb')).toBe('/assets/models/a.glb');
    expect(m.resolveUrl('/root.glb')).toBe('/root.glb');
    expect(m.resolveUrl('https://cdn/x.glb')).toBe('https://cdn/x.glb');
    expect(m.resolveUrl('data:image/png;base64,AA')).toBe('data:image/png;base64,AA');
  });

  test('進度、whenIdle、preload、群組釋放', async () => {
    const m = new AssetManager();
    const fake = controllableLoader(['.fake'], (url) => ({ url }));
    m.registerLoader('fake', fake.loader);
    const events: string[] = [];
    m.onProgress((p, url) => events.push(`${url} ${p.loaded}/${p.total}`));

    const group = m.group();
    const all = m.preload(['x.fake']);
    group.load('y.fake');
    expect(m.loading).toBe(true);
    let idle = false;
    m.whenIdle().then(() => (idle = true));
    await tick();
    fake.resolve('x.fake');
    await all;
    expect(idle).toBe(false);
    fake.resolve('y.fake');
    await tick();
    expect(idle).toBe(true);
    expect(events).toEqual(['x.fake 1/2', 'y.fake 2/2']);
    expect(m.progress.total).toBe(0);

    group.releaseAll();
    expect(fake.disposed.map((d) => (d as { url: string }).url)).toEqual(['y.fake']);
    expect(m.isLoaded('x.fake')).toBe(true);
  });
});

describe('object3d.dispose', () => {
  test('共用的幾何、材質、貼圖只釋放一次', () => {
    const geo = new THREE.BoxGeometry();
    const tex = new THREE.Texture();
    const mat = new THREE.MeshStandardMaterial({ map: tex });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geo, mat), new THREE.Mesh(geo, [mat, mat]));
    const counts = { geo: 0, mat: 0, tex: 0 };
    geo.addEventListener('dispose', () => counts.geo++);
    mat.addEventListener('dispose', () => counts.mat++);
    tex.addEventListener('dispose', () => counts.tex++);
    object3d.dispose(root);
    expect(counts).toEqual({ geo: 1, mat: 1, tex: 1 });
  });
});

describe('Model 元件', () => {
  function setup() {
    const clock = fakeScheduler();
    const fake = controllableLoader(['.glb'], () => {
      const scene = new THREE.Group();
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
      return { scene, animations: [new THREE.AnimationClip('walk', 1, [])] } as unknown as GLTF;
    });
    const ecs = new EcsPlugin();
    const assets = new AssetPlugin({ noDefaultLoaders: true });
    assets.assets.registerLoader('gltf', fake.loader);
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    engine.use(ecs).use(new ScenePlugin()).use(assets);
    engine.start();
    return { clock, fake, world: ecs.world, assets: assets.assets, engine };
  }

  test('載入完成後加上 SceneObject（複製品）、套用陰影、帶出動畫', async () => {
    const { clock, fake, world, assets } = setup();
    const e = world.spawn(Transform, Model.with({ url: 'hero.glb', castShadow: true }));
    expect(world.get(e, Model)!.status).toBe('loading');
    await tick();
    fake.resolve('hero.glb');
    await tick();
    expect(world.has(e, SceneObject)).toBe(false); // 下一幀才套用
    clock.frame(16);
    const model = world.get(e, Model)!;
    expect(model.status).toBe('ready');
    expect(model.animations.map((a) => a.name)).toEqual(['walk']);
    const object = world.get(e, SceneObject)!.object!;
    expect(object).not.toBe(assets.get('hero.glb', 'gltf')!.scene);
    expect(object.children[0].castShadow).toBe(true);

    model.castShadow = false;
    clock.frame(16);
    expect(object.children[0].castShadow).toBe(false);

    // 兩個實體共用同一份資源；全部移除後才釋放
    const e2 = world.spawn(Transform, Model.with({ url: 'hero.glb' }));
    expect(assets.refCount('hero.glb', 'gltf')).toBe(2);
    world.destroy(e);
    expect(fake.disposed).toHaveLength(0);
    world.remove(e2, Model);
    expect(fake.disposed).toHaveLength(1);
  });

  test('換網址、載入中被銷毀、載入失敗', async () => {
    const { clock, fake, world, assets } = setup();
    const e = world.spawn(Transform, Model.with({ url: 'a.glb' }));
    await tick();
    fake.resolve('a.glb');
    await tick();
    clock.frame(16);
    const first = world.get(e, SceneObject)!.object;

    world.get(e, Model)!.url = 'b.glb';
    clock.frame(16);
    expect(world.get(e, SceneObject)!.object).toBeNull(); // 舊模型先拿掉
    expect(assets.refCount('a.glb', 'gltf')).toBe(0);
    await tick();
    fake.resolve('b.glb');
    await tick();
    clock.frame(16);
    expect(world.get(e, SceneObject)!.object).not.toBe(first);

    // 載入中就銷毀：完成後不會再加元件，資源也會釋放
    const doomed = world.spawn(Transform, Model.with({ url: 'c.glb' }));
    world.destroy(doomed);
    await tick();
    fake.resolve('c.glb');
    await tick();
    clock.frame(16);
    expect(assets.isLoaded('c.glb', 'gltf')).toBe(false);

    // 失敗
    const bad = world.spawn(Transform, Model.with({ url: 'bad.glb' }));
    await tick();
    const originalError = console.error;
    console.error = () => {};
    fake.reject('bad.glb', '404');
    await tick();
    clock.frame(16);
    console.error = originalError;
    expect(world.get(bad, Model)!.status).toBe('error');
    expect(world.get(bad, Model)!.error!.message).toMatch(/404/);
  });
});

describe('示範模型（真正的 GLTFLoader）', () => {
  test('pyramid.gltf 可以解析，含網格與 Spin、Bob 兩個動畫', async () => {
    // Node 沒有瀏覽器的 ProgressEvent（three.js 的 FileLoader 會用到），補一個最小替身
    (globalThis as Record<string, unknown>).ProgressEvent ??= class extends Event {
      constructor(type: string, init: object = {}) {
        super(type);
        Object.assign(this, init);
      }
    };
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const json = (await import('../projects/official-demo-000-start/public/models/pyramid.gltf?raw')).default;
    const gltf = await new GLTFLoader().parseAsync(json, '');
    const mesh = gltf.scene.getObjectByName('Pyramid') as THREE.Mesh;
    expect(mesh.isMesh).toBe(true);
    expect(mesh.geometry.getAttribute('position').count).toBe(18);
    expect(gltf.animations.map((a) => a.name)).toEqual(['Spin', 'Bob']);
    expect(gltf.animations[0].duration).toBe(4);
  });
});
