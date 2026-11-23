import { describe, expect, test } from 'vitest';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { Name, Parent, ScenePlugin, Transform, type SceneFileData } from '../src/scene';
import { MeshRenderer, RenderPlugin } from '../src/render';
import {
  SceneDoc,
  duplicateEntities,
  insertEntity,
  moveEntity,
  removeEntities,
  renameEntity,
  setComponent,
} from '../src/editors/s3d-editor/doc';
import { WorldSync } from '../src/editors/s3d-editor/sync';
import { fakeScheduler } from './helpers';

const file = (entities: SceneFileData['entities']): SceneFileData => ({ format: 'hero-scene', version: 1, entities });
const ids = (d: SceneDoc | SceneFileData) => d.entities.map((e) => e.id);

function sample(): SceneFileData {
  return file([
    { id: 'root', name: '根' },
    { id: 'a', parent: 'root' },
    { id: 'a1', parent: 'a' },
    { id: 'b', parent: 'root' },
    { id: 'c' },
  ]);
}

describe('3D 場景編輯器：復原／重做', () => {
  test('commit、undo、redo、dirty', () => {
    const doc = new SceneDoc();
    doc.load(sample());
    expect(doc.dirty).toBe(false);
    expect(doc.commit('改名', (d) => renameEntity(d, 'c', '相機'))).toBe(true);
    expect(doc.get('c')!.name).toBe('相機');
    expect(doc.dirty).toBe(true);
    expect(doc.undoLabel).toBe('改名');
    doc.undo();
    expect(doc.get('c')!.name).toBeUndefined();
    expect(doc.dirty).toBe(false);
    doc.redo();
    expect(doc.get('c')!.name).toBe('相機');
    doc.markSaved();
    expect(doc.dirty).toBe(false);
    // 沒有變化不記錄；新的修改清掉重做
    expect(doc.commit('沒事', () => {})).toBe(false);
    doc.undo();
    doc.commit('刪除', (d) => removeEntities(d, ['b']));
    expect(doc.canRedo).toBe(false);
  });

  test('同一個 merge 鍵的連續修改合併成一步，seal 後分開', () => {
    const doc = new SceneDoc();
    doc.load(sample());
    for (const x of [1, 2, 3])
      doc.commit('移動', (d) => setComponent(d, 'c', 'Transform', { position: [x, 0, 0] }), { merge: 'c.pos' });
    doc.seal();
    doc.commit('移動', (d) => setComponent(d, 'c', 'Transform', { position: [9, 0, 0] }), { merge: 'c.pos' });
    doc.undo();
    expect(doc.get('c')!.components).toEqual({ Transform: { position: [3, 0, 0] } });
    doc.undo();
    expect(doc.get('c')!.components).toBeUndefined();
    expect(doc.canUndo).toBe(false);
  });

  test('外部拿到的資料是複本', () => {
    const doc = new SceneDoc();
    const data = sample();
    doc.load(data);
    data.entities.length = 0;
    doc.toFile().entities.length = 0;
    expect(ids(doc)).toEqual(['root', 'a', 'a1', 'b', 'c']);
  });
});

describe('3D 場景編輯器：修改工具', () => {
  test('加入：放在父節點最後一個子孫後面，id 不重複', () => {
    const d = sample();
    expect(insertEntity(d, { id: 'a', parent: 'root' })).toBe('a2');
    expect(ids(d)).toEqual(['root', 'a', 'a1', 'b', 'a2', 'c']);
    expect(insertEntity(d, { id: 'x' }, 'a')).toBe('x');
    expect(ids(d)[1]).toBe('x');
  });

  test('刪除連同子孫', () => {
    const d = sample();
    removeEntities(d, ['a']);
    expect(ids(d)).toEqual(['root', 'b', 'c']);
  });

  test('複製連同子孫，祖先被選到時子孫不重複', () => {
    const d = sample();
    const out = duplicateEntities(d, ['a', 'a1']);
    expect(out).toEqual(['a2']);
    expect(ids(d)).toEqual(['root', 'a', 'a1', 'a2', 'a3', 'b', 'c']);
    expect(d.entities.find((e) => e.id === 'a3')!.parent).toBe('a2');
    expect(d.entities.find((e) => e.id === 'a2')!.parent).toBe('root');
  });

  test('移動：改父節點、排順序，不能放進自己的子孫', () => {
    const d = sample();
    expect(moveEntity(d, 'a', 'a1')).toBe(false);
    expect(moveEntity(d, 'a', 'a')).toBe(false);
    expect(moveEntity(d, 'c', 'root', 'a')).toBe(true);
    expect(d.entities.find((e) => e.id === 'c')!.parent).toBe('root');
    expect(ids(d)).toEqual(['root', 'c', 'a', 'a1', 'b']);
    expect(moveEntity(d, 'a1', null)).toBe(true);
    expect(d.entities.find((e) => e.id === 'a1')!.parent).toBeUndefined();
    expect(ids(d).at(-1)).toBe('a1');
  });

  test('元件：設定、移除；名稱空白代表沒有名稱', () => {
    const d = sample();
    setComponent(d, 'c', 'Camera', { fov: 40 });
    expect(d.entities[4].components).toEqual({ Camera: { fov: 40 } });
    setComponent(d, 'c', 'Camera', undefined);
    expect(d.entities[4].components).toBeUndefined();
    renameEntity(d, 'root', '  ');
    expect(d.entities[0].name).toBeUndefined();
  });
});

describe('3D 場景編輯器：同步到 world', () => {
  function setup() {
    const ecs = new EcsPlugin();
    const engine = new Engine({ scheduler: fakeScheduler().scheduler, pauseOnHidden: false });
    const renderer = {
      domElement: { parentElement: null, remove() {} },
      shadowMap: { enabled: false, type: 0 },
      setPixelRatio() {},
      setSize() {},
      render() {},
      clear() {},
      dispose() {},
    } as unknown as import('three/webgpu').WebGPURenderer;
    engine
      .use(ecs)
      .use(new ScenePlugin())
      .use(new RenderPlugin({ renderer, size: { width: 10, height: 10 } }));
    return { world: ecs.world, sync: new WorldSync(ecs.world) };
  }

  test('建立、更新（就地）、刪除、改父節點', () => {
    const { world, sync } = setup();
    const data = file([
      { id: 'p', name: 'P', components: { Transform: { position: [1, 2, 3] } } },
      { id: 'box', parent: 'p', components: { MeshRenderer: { geometry: { box: 1 }, material: '#f00' } } },
    ]);
    sync.apply(data);
    const p = sync.entityOf('p')!;
    const box = sync.entityOf('box')!;
    expect(world.get(p, Name)!.value).toBe('P');
    expect(world.get(box, Parent)!.entity).toBe(p);
    const mesh = world.get(box, MeshRenderer)!;

    // 改材質：同一份元件資料被更新（不是移除再加）；省略的欄位回到預設
    data.entities[1].components = { MeshRenderer: { geometry: { box: 1 }, material: '#0f0' } };
    data.entities[0].components = { Transform: {} };
    sync.apply(data);
    expect(world.get(box, MeshRenderer)).toBe(mesh);
    expect(mesh.material).toBe('#0f0');
    expect(world.get(p, Transform)!.position.toArray()).toEqual([0, 0, 0]);

    // 刪掉父節點，子節點留著並變成最上層
    sync.apply(file([{ id: 'box', components: data.entities[1].components }]));
    expect(world.isAlive(p)).toBe(false);
    expect(world.isAlive(box)).toBe(true);
    expect(world.has(box, Parent)).toBe(false);
    expect(sync.idOf(box)).toBe('box');

    // 移除元件、名稱
    sync.apply(file([{ id: 'box' }]));
    expect(world.has(box, MeshRenderer)).toBe(false);
    sync.clear();
    expect(world.isAlive(box)).toBe(false);
  });

  test('資料錯誤與沒有登記的元件變成警告，不會中斷', () => {
    const { sync } = setup();
    sync.apply(file([{ id: 'x', components: { Light: { kind: 'laser' }, Health: { hp: 1 } } }, { id: 'y' }]));
    expect(sync.warnings).toHaveLength(2);
    expect(sync.entityOf('y')).toBeDefined();
  });
});

describe('3D 場景編輯器：預製物件內部覆蓋', () => {
  test('寫入、改名、還原，空的覆蓋會清掉', async () => {
    const { writeComponent, writeName, revertOverride, overriddenOf } = await import(
      '../src/editors/s3d-editor/prefabs'
    );
    const d = file([{ id: 't', prefab: 'p' }, { id: 'n' }]);
    writeComponent(d, 't/leaf', 'Camera', { fov: 20 });
    writeComponent(d, 't/leaf', 'Light', undefined);
    writeName(d, 't/leaf', ' 葉 ');
    expect(d.entities[0].overrides).toEqual({ leaf: { components: { Camera: { fov: 20 }, Light: null }, name: '葉' } });
    expect(overriddenOf(d, 't/leaf')).toEqual({ name: true, components: new Set(['Camera', 'Light']) });
    revertOverride(d, 't/leaf', 'Camera');
    revertOverride(d, 't/leaf', 'Light');
    expect(d.entities[0].overrides).toEqual({ leaf: { name: '葉' } });
    revertOverride(d, 't/leaf');
    expect(d.entities[0].overrides).toBeUndefined();
    // 一般實體照常
    writeComponent(d, 'n', 'Camera', {});
    writeName(d, 'n', 'N');
    expect(d.entities[1]).toEqual({ id: 'n', name: 'N', components: { Camera: {} } });
  });
});

describe('3D 場景編輯器：尋路格子', () => {
  test('畫格子、全部可走、改範圍保留擋住的位置、從碰撞體產生', async () => {
    const THREE = await import('three');
    const { paintCells, clearCells, resizeNavGrid, bakeFromBoxes, navGridStats } = await import(
      '../src/editors/s3d-editor/navgrid'
    );
    const base = { min: [0, 0] as [number, number], max: [4, 4] as [number, number], cellSize: 1 };
    const painted = paintCells(
      base,
      [
        [1, 1],
        [2, 1],
      ],
      false,
    );
    expect(navGridStats(painted)).toEqual({ cols: 4, rows: 4, blocked: 2 });
    expect(paintCells(painted, [[1, 1]], true).walkable).toEqual([6, 1, 9]);
    expect(clearCells(painted)).toEqual(base);
    // 範圍往左延伸 2 格：擋住的格子位置不變（欄號 +2）
    const wider = resizeNavGrid(painted, { min: [-2, 0] });
    expect(navGridStats(wider)).toEqual({ cols: 6, rows: 4, blocked: 2 });
    // 地板（頂端在 0.05）不算；箱子擋住它佔的格子（往外半格）
    const floor = new THREE.Box3(new THREE.Vector3(-10, -0.05, -10), new THREE.Vector3(10, 0.05, 10));
    const crate = new THREE.Box3(new THREE.Vector3(1.2, 0, 1.2), new THREE.Vector3(1.8, 1, 1.8));
    expect(navGridStats(bakeFromBoxes(base, [floor, crate]))).toEqual({ cols: 4, rows: 4, blocked: 1 });
    expect(navGridStats(bakeFromBoxes(base, [floor, crate], { margin: 0.8 })).blocked).toBe(9);
  });
});
