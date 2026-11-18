/// <reference types="vite/client" />
/**
 * 範例專案 official-demo-000-start 的場景檔（public/scenes、public/prefabs，3D 場景編輯器可以編輯）：
 * 格式正確、建立實體沒有警告，而且遊戲程式（projects/official-demo-000-start/src/levels.ts）用到的 id 都在。
 */
import { describe, expect, test } from 'vitest';
import { World } from '../src/ecs';
import {
  Hierarchy,
  HierarchyKey,
  SceneCodecs,
  expandPrefabs,
  parseSceneFile,
  prefabPaths,
  spawnSceneFile,
  stringifySceneXml,
  transformCodec,
  type SceneFileData,
} from '../src/scene';
import { cameraCodec, lightCodec, meshRendererCodec } from '../src/render';
import { modelCodec } from '../src/assets';
import { animatorCodec } from '../src/animation';
import { colliderCodec, rigidBodyCodec } from '../src/physics/sceneCodecs';
import { particleEmitterCodec } from '../src/particles';
import { audioSourceCodec } from '../src/audio';
import { text3dCodec } from '../src/text3d';
import { uiPanel3dCodec } from '../src/ui3d';
import { scriptListCodec } from '../src/scripts/ScriptList';

const sources = import.meta.glob(
  [
    '../projects/official-demo-000-start/public/scenes/*.xml',
    '../projects/official-demo-000-start/public/prefabs/*.xml',
  ],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>;
/** 'scenes/orbit.xml' → 內容 */
const files = Object.fromEntries(
  Object.entries(sources).map(([path, xml]) => [path.replace('../projects/official-demo-000-start/public/', ''), xml]),
);
const uiFiles = import.meta.glob('../projects/official-demo-000-start/public/ui/**/*.xml');

/** 讀場景檔並填入用到的預製物件（和 load.sceneFile 一樣，只是不用網路） */
function load(path: string): SceneFileData {
  const data = parseSceneFile(files[path]);
  data.prefabs = {};
  for (let todo = prefabPaths(data); todo.length; todo = prefabPaths(data).filter((p) => !(p in data.prefabs!)))
    for (const p of todo) data.prefabs[p] = parseSceneFile(files[p]);
  return data;
}

function spawn(data: SceneFileData) {
  const world = new World();
  world.setResource(HierarchyKey, new Hierarchy(world));
  const codecs = new SceneCodecs();
  for (const c of [
    transformCodec,
    meshRendererCodec,
    cameraCodec,
    lightCodec,
    modelCodec,
    animatorCodec,
    rigidBodyCodec,
    colliderCodec,
    particleEmitterCodec,
    audioSourceCodec,
    text3dCodec,
    uiPanel3dCodec,
    scriptListCodec,
  ])
    codecs.register(c as never);
  return spawnSceneFile(world, data, codecs);
}

describe('official-demo-000-start 的場景檔', () => {
  test('有環繞軌道、方塊雨兩個場景，以及舞台、球、箱子、金幣預製物件', () => {
    expect(Object.keys(files).sort()).toEqual([
      'prefabs/ball.xml',
      'prefabs/coin.xml',
      'prefabs/crate.xml',
      'prefabs/stage.xml',
      'scenes/orbit.xml',
      'scenes/rain.xml',
    ]);
  });

  test.each(['scenes/orbit.xml', 'scenes/rain.xml'])('%s 建立實體沒有警告', (path) => {
    const spawned = spawn(load(path));
    expect(spawned.warnings).toEqual([]);
    // 遊戲程式依 id 加上遊戲邏輯（levels.ts）
    for (const id of ['stage', 'stage/camera', 'stage/flag', 'stage/title', 'stage/floor'])
      expect(spawned.entities.has(id), id).toBe(true);
  });

  test('環繞軌道：遊戲程式用到的物件都在', () => {
    const spawned = spawn(load('scenes/orbit.xml'));
    for (const id of [
      'cube',
      'moon',
      'pyramid',
      'pulse-ring',
      'kiosk',
      'hologram',
      'ball-1',
      'ball-1/visual',
      'coin-8',
    ])
      expect(spawned.entities.has(id), id).toBe(true);
  });

  test('方塊雨：30 顆球、16 個箱子', () => {
    const ids = [...spawn(load('scenes/rain.xml')).entities.keys()];
    expect(ids.filter((id) => /^ball-\d+$/.test(id))).toHaveLength(30);
    expect(ids.filter((id) => /^crate-\d+$/.test(id))).toHaveLength(16);
  });

  test('搭配的介面檔都存在（3D 場景編輯器的 UI 層）', () => {
    for (const path of ['scenes/orbit.xml', 'scenes/rain.xml']) {
      const ui = parseSceneFile(files[path]).ui ?? [];
      expect(ui.length, path).toBeGreaterThan(0);
      for (const u of ui) expect(Object.keys(uiFiles), u).toContain(`../projects/official-demo-000-start/public/${u}`);
    }
  });

  test('檔案就是編輯器存檔的格式（存了再讀不會變）', () => {
    for (const [path, xml] of Object.entries(files)) expect(stringifySceneXml(parseSceneFile(xml)), path).toBe(xml);
  });

  test('預製物件展開後只有一個舞台', () => {
    const flat = expandPrefabs(load('scenes/orbit.xml')).data;
    expect(flat.entities.filter((e) => e.parent === undefined && e.id === 'stage')).toHaveLength(1);
  });
});
