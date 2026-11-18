/// <reference types="vite/client" />
import { describe, expect, test } from 'vitest';
import { parseSceneFile, stringifySceneFile, stringifySceneXml, type SceneFileData } from '../src/scene';

const sample: SceneFileData = {
  format: 'hero-scene',
  version: 1,
  ui: ['ui/scene.xml', 'ui/orbit/hud.xml'],
  settings: {
    background: '#15181f',
    fog: { color: '#223344', near: 10, far: 40 },
    navGrid: { min: [-9.5, -9.5], max: [9.5, 9.5], cellSize: 0.5, walkable: [1444] },
    postfx: null,
  },
  entities: [
    {
      id: 'cam',
      name: '攝影機',
      components: { Transform: { position: [0, 2, 6], rotation: [-15, 0, 0] }, Camera: {} },
    },
    {
      id: 'box',
      name: '箱子 "A" & <B>',
      parent: 'root',
      components: {
        MeshRenderer: {
          geometry: { plane: [4, 1.6, 48, 20], rotation: [1.5707963, 0, 0] },
          material: { standard: { color: '#ffa94f', roughness: 0.3, map: 'textures/a.png', repeat: 10 } },
          castShadow: true,
        },
        Text3D: { text: '12', label: 'true', multi: '第一行\n第二行\t!', spaced: '1 2 3', empty: '' },
        Weird: { is: 1, key: 'k', 中文: 2, 'a/b': [1], nested: [[1, 2], { x: null }, 'x', true, 3] },
        Nothing: null,
      },
    },
    { id: 'root', components: { Transform: { scale: [2, 2, 2] } } },
    {
      id: 'tree1',
      prefab: 'prefabs/tree.xml',
      components: { Transform: { position: [3, 0, -1e-7] } },
      overrides: { 'a/leaf': { name: '紅葉', components: { MeshRenderer: { material: '#cc3322' }, Collider: null } } },
    },
  ],
};

describe('場景檔 XML', () => {
  test('存成 XML 再讀回來，內容不變', () => {
    const xml = stringifySceneXml(sample);
    const back = parseSceneFile(xml);
    // XML 依父子關係排列：root 會在 box 前面（父節點先寫）
    const byId = (d: SceneFileData) => Object.fromEntries(d.entities.map((e) => [e.id, e]));
    expect(byId(back)).toEqual(byId(sample));
    expect(back.settings).toEqual(sample.settings);
    expect(back.ui).toEqual(sample.ui);
    // 再存一次結果一樣
    expect(stringifySceneXml(back)).toBe(xml);
  });

  test('子實體寫在父實體裡、數字陣列寫成屬性', () => {
    const xml = stringifySceneXml(sample);
    expect(xml).toContain('<Transform position="0 2 6" rotation="-15 0 0"/>');
    expect(xml).toMatch(/<Entity id="root">[\s\S]*<Entity id="box"/);
    expect(xml).toContain('<text is="string" value="12"/>');
    expect(xml).toContain('<Collider is="null"/>');
    expect(xml).toContain('<SceneUI src="ui/scene.xml"/>');
  });

  test('和 JSON 格式得到一樣的資料', () => {
    const fromJson = parseSceneFile(stringifySceneFile(sample));
    const fromXml = parseSceneFile(stringifySceneXml(sample));
    const sort = (d: SceneFileData) => [...d.entities].sort((a, b) => a.id.localeCompare(b.id));
    expect(sort(fromXml)).toEqual(sort(fromJson));
  });

  test('手寫的 XML：註解、單引號、省略 format', () => {
    const data = parseSceneFile(`
      <!-- 測試 -->
      <Scene version="1">
        <Entity id='a' name="A">
          <Transform position="1 2 3"/>
          <Light kind="point" intensity="8" castShadow="true"/>
        </Entity>
      </Scene>`);
    expect(data.entities).toEqual([
      {
        id: 'a',
        name: 'A',
        components: { Transform: { position: [1, 2, 3] }, Light: { kind: 'point', intensity: 8, castShadow: true } },
      },
    ]);
  });

  test('錯誤訊息附上行號', () => {
    expect(() => parseSceneFile('<Scene version="1">\n  <Entity name="x"/>\n</Scene>')).toThrow(/第 2 行.*缺少 id/);
    expect(() => parseSceneFile('<Scene version="1">\n  <Entity id="a">\n</Scene>')).toThrow(/XML/);
    expect(() => parseSceneFile('<Scene version="1"><Foo/></Scene>')).toThrow(/只能放/);
    expect(() => parseSceneFile('<Scene version="1"><Entity id="a"><T>文字</T></Entity></Scene>')).toThrow(
      /不能直接寫文字/,
    );
    expect(() => parseSceneFile('<Scene version="1"><Entity id="a"/><Entity id="a"/></Scene>')).toThrow(/重複/);
  });
});

describe('手冊的場景檔例子', () => {
  const chapter = Object.values(
    import.meta.glob('../doc/manual/chapters/05-scene.html', { query: '?raw', import: 'default', eager: true }),
  )[0] as string;
  const example = (title: string) => {
    const m = new RegExp(`data-title="${title}">\\n([\\s\\S]*?)</script>`).exec(chapter);
    if (!m) throw new Error(`找不到例子 ${title}`);
    return m[1];
  };

  test('XML 寫法和 JSON 寫法的實體相同', () => {
    const json = parseSceneFile(example('public/scenes/forest.json'));
    const xml = parseSceneFile(example('public/scenes/forest.xml'));
    expect(xml.entities).toEqual(json.entities);
    expect(xml.ui).toEqual(['ui/scene.xml']);
    expect(xml.settings).toEqual({ background: '#87ceeb', fog: { color: '#87ceeb', near: 10, far: 40 } });
  });
});
