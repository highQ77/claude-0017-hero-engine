# @engine/scene 的範例

## Hierarchy
父子關係（`hierarchy`）：子物件跟著父物件移動、旋轉。這裡讓月亮繞著會轉的地球。

```ts
spawn.camera(world, { position: [0, 3, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
const earth = spawn.mesh(world, { geometry: { sphere: 0.7 }, material: '#4cc9f0' });
const moon = spawn.mesh(world, { geometry: { sphere: 0.2 }, material: '#dddddd', position: [1.8, 0, 0] });
hierarchy.setParent(moon, earth);
console.log('月亮的父物件是地球嗎？', hierarchy.parentOf(moon) === earth, '，地球的子物件：', hierarchy.childrenOf(earth).length);
engine.on('update', (t) => math.rotate(world.require(earth, Transform), [0, t.delta, 0]));
engine.start();
```

## SceneCodecs
場景檔的元件存讀規則（`scenePlugin.codecs`）：自己的元件登記之後，就能寫在場景檔裡、用 3D 場景編輯器編輯。

```ts
const Coin = define.component('Coin', () => ({ value: 1 }));
scenePlugin.codecs.register(plainCodec(Coin));
const file = parseSceneFile(`<Scene version="1"><Entity id="c"><Coin value="5"/></Entity></Scene>`);
const spawned = spawnSceneFile(world, file);
console.log('讀到的 Coin：', world.require(spawned.entities.get('c')!, Coin));
console.log('已登記的元件：', scenePlugin.codecs.all().map((c) => c.type.name).join('、'));
```

## SceneManager
場景管理（`scenes`）：註冊好幾個場景，`load` 切換；切換時上一個場景建立的實體會自動移除。點畫面切換場景。

```ts
spawn.defaultLights(world);
const camera = spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
scenes.persist(camera); // 攝影機不隨場景移除
scenes.register(
  { name: 'red', setup: (w) => void spawn.mesh(w, { geometry: { box: 1 }, material: '#ff6b6b' }) },
  { name: 'blue', setup: (w) => void spawn.mesh(w, { geometry: { sphere: 0.7 }, material: '#4cc9f0' }) },
);
scenes.load('red');
addEventListener('pointerdown', () => {
  scenes.load(scenes.active === 'red' ? 'blue' : 'red');
  console.log('目前的場景：', scenes.active, '，實體數：', world.entityCount);
});
engine.start();
```

## ScenePlugin
場景外掛提供父子關係、Transform 計算與場景管理（手冊的 `scenePlugin` 已經裝好）。

```ts
console.log('外掛名稱：', scenePlugin.name, '，依賴：', scenePlugin.dependencies.join('、'));
console.log('同一個場景管理：', scenePlugin.scenes === scenes);
const parent = world.spawn(Transform.at(0, 1, 0));
const child = world.spawn(Transform.at(0, 0.5, 0));
scenePlugin.hierarchy.setParent(child, parent);
tick.transforms(world);
console.log('子物件的世界座標：', math.worldPosition(world.require(child, Transform)));
```

## applySceneSettings
套用場景設定（背景、霧…），回傳可以恢復原狀的函式。

```ts
spawn.camera(world, { position: [0, 2, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
for (let i = 0; i < 6; i++) spawn.mesh(world, { geometry: { box: 0.8 }, material: '#9acd32', position: [0, 0, -i * 2] });
const { undo, warnings } = applySceneSettings(world, { background: '#20304a', fog: { color: '#20304a', near: 2, far: 12 } });
console.log('警告：', warnings);
engine.timers.after(2, () => {
  undo();
  console.log('2 秒後恢復原本的背景與霧');
});
engine.start();
```

## expandPrefabs
把預製物件的實例展開成實際的內容（`load.sceneFile` 會自動處理；自己組資料時用）。

```ts
const tree = parseSceneFile(`<Scene version="1"><Entity id="tree"><Transform/><Entity id="leaf"><Transform position="0 1 0"/></Entity></Entity></Scene>`);
const level = parseSceneFile(`<Scene version="1"><Entity id="t1" prefab="prefabs/tree.xml"><Transform position="3 0 0"/></Entity></Scene>`);
const { data, warnings } = expandPrefabs({ ...level, prefabs: { 'prefabs/tree.xml': tree } });
console.log('展開後的實體：', data.entities.map((e) => e.id).join('、'), '，警告：', warnings.length);
```

## loadSceneFile
下載並檢查場景檔（連同用到的預製物件）。這裡把場景檔做成一個暫時的網址再下載。

```ts
const xml = `<Scene version="1">
  <Entity id="camera"><Transform position="0 2 5"/><Camera fov="55"/></Entity>
  <Entity id="sun"><Transform position="3 5 2"/><Light kind="directional" intensity="2"/></Entity>
  <Entity id="box"><Transform/><MeshRenderer><geometry box="1"/><material><standard color="#ffa94f"/></material></MeshRenderer></Entity>
</Scene>`;
const url = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }));
const file = await loadSceneFile(url);
console.log('實體：', file.entities.map((e) => e.id).join('、'));
const spawned = spawnSceneFile(world, file);
math.lookAt(world.require(spawned.entities.get('camera')!, Transform), new Vector3(0, 0, 0));
engine.start();
```

## notifySceneFileChanged
通知場景檔改了：用 `sceneFromFile` 建立、而且是那個網址的場景會重新載入（開發伺服器存檔時自動呼叫）。

```ts
let loads = 0;
const file = await loadSceneFile('scenes/demo.xml'); // doc/public/scenes/demo.xml
scenes.register(
  sceneFromFile('demo', file, { hotReload: 'scenes/demo.xml', setup: () => console.log('場景建立（第', ++loads, '次）') }),
);
scenes.load('demo');
// 開發時存檔就會這樣通知：重新下載場景檔、重建場景
setTimeout(() => notifySceneFileChanged('scenes/demo.xml'), 1000);
engine.start();
```

## parseSceneFile
檢查並轉換場景檔（XML 或 JSON 文字，或物件）。格式錯誤時，錯誤訊息會說是哪個實體、哪個欄位。

```ts
const file = parseSceneFile(`<Scene version="1"><Entity id="hero" name="主角"><Transform position="1 0 2"/></Entity></Scene>`);
console.log('格式：', file.format, '，實體：', file.entities[0]);
try {
  parseSceneFile({ format: 'hero-scene', version: 1, entities: [{ id: 'a' }, { id: 'a' }] });
} catch (error) {
  console.log('格式錯誤：', (error as Error).message);
}
```

## plainCodec
一般元件的存讀規則：欄位是數字、文字、布林、顏色、角度時用它，不用自己寫轉換。

```ts
const Lamp = define.component('Lamp', () => ({ color: 0xffcc66, angle: Math.PI / 4, on: true }));
const codec = plainCodec(Lamp, { colors: ['color'], angles: ['angle'] });
console.log('存成檔案：', codec.write({ color: 0xffcc66, angle: Math.PI / 4, on: false }));
console.log('從檔案讀回：', codec.read({ color: '#ff0000', angle: 90 }, { entity: 'a', component: 'Lamp', warn: console.warn }));
```

## prefabPaths
找出場景檔需要哪些預製物件（包含預製物件裡面用到的）。

```ts
const level = parseSceneFile(`<Scene version="1">
  <Entity id="a" prefab="prefabs/tree.xml"/>
  <Entity id="b" prefab="prefabs/rock.xml"/>
  <Entity id="c" prefab="prefabs/tree.xml"/>
</Scene>`);
console.log('需要的預製物件：', prefabPaths(level));
```

## prefabRoot
預製物件檔的根節點（預製物件檔要剛好有一個最上層的實體）。

```ts
const prefab = parseSceneFile(`<Scene version="1"><Entity id="crate" name="箱子"><Transform/><Entity id="lid"><Transform/></Entity></Entity></Scene>`);
const root = prefabRoot(prefab, 'prefabs/crate.xml');
console.log('根節點：', root.id, root.name);
```

## previewScene
3D 場景編輯器按「預覽」打開遊戲時，回傳要進入的場景名稱；平常是 null，就進入第一個場景。

```ts
const start = previewScene() ?? 'main';
console.log('要進入的場景：', start, '（從 3D 場景編輯器預覽時會是正在編輯的場景）');
```

## readVec3
讀取 [x, y, z]（自己寫存讀規則時用）；格式不對時丟出清楚的錯誤。

```ts
console.log(readVec3([1, 2, 3], 'position'));
try {
  readVec3([1, 'x'], 'position');
} catch (error) {
  console.log('錯誤：', (error as Error).message);
}
```

## registerSceneCodecs
外掛安裝時登記自己元件的存讀規則；回傳取消登記的函式。

```ts
const Score = define.component('Score', () => ({ points: 0 }));
const off = registerSceneCodecs(world, [plainCodec(Score)] as never[]);
console.log('登記了嗎？', !!scenePlugin.codecs.get('Score'));
off();
console.log('取消之後：', !!scenePlugin.codecs.get('Score'));
```

## registerSceneSettings
登記自己的場景設定（場景檔 settings 裡的一個鍵）：套用時做事，回傳恢復的函式。

```ts
let gravity = 9.8;
registerSceneSettings(world, [
  {
    key: 'gravity',
    apply(value) {
      const before = gravity;
      gravity = Number(value);
      return () => (gravity = before);
    },
  },
]);
const { undo } = applySceneSettings(world, { gravity: 1.6 });
console.log('月球重力：', gravity);
undo();
console.log('恢復：', gravity);
```

## sceneFromFile
用場景檔建立場景交給 `scenes.register`；`setup` 在實體建立好之後執行，用來加上遊戲邏輯。

```ts
const file = parseSceneFile(`<Scene version="1">
  <Entity id="camera"><Transform position="0 2 5"/><Camera/></Entity>
  <Entity id="sun"><Transform position="2 4 3"/><Light kind="directional" intensity="2"/></Entity>
  <Entity id="box"><Transform/><MeshRenderer><geometry box="1"/><material><standard color="#9acd32"/></material></MeshRenderer></Entity>
</Scene>`);
scenes.register(
  sceneFromFile('main', file, {
    setup(w, spawned) {
      math.lookAt(w.require(spawned.entities.get('camera')!, Transform), new Vector3(0, 0, 0));
      const box = spawned.entities.get('box')!;
      engine.on('update', (t) => w.isAlive(box) && math.rotate(w.require(box, Transform), [0, t.delta, 0]));
    },
  }),
);
scenes.load('main');
engine.start();
```

## spawnSceneFile
依場景檔建立實體，回傳「檔案 id → 實體」的對照表。

```ts
const file = parseSceneFile(`<Scene version="1">
  <Entity id="player" name="玩家"><Transform position="0 1 0"/></Entity>
  <Entity id="sword" parent="player"><Transform position="0.5 0 0"/></Entity>
</Scene>`);
const spawned = spawnSceneFile(world, file);
const sword = spawned.entities.get('sword')!;
tick.transforms(world);
console.log('建立了', spawned.entities.size, '個實體；劍的世界座標：', math.worldPosition(world.require(sword, Transform)));
```

## stringifySceneFile
場景檔轉成 JSON 文字（兩格縮排）。

```ts
const file = parseSceneFile(`<Scene version="1"><Entity id="a" name="方塊"><Transform position="1 2 3"/></Entity></Scene>`);
console.log(stringifySceneFile(file));
```

## stringifySceneXml
場景檔轉成 XML 文字（3D 場景編輯器存的格式）。

```ts
const box = world.spawn(Name.with({ value: '方塊' }), Transform.at(0, 1, 0));
const file = writeSceneFile(world, [box]);
console.log(stringifySceneXml(file));
```

## tidy
去掉 -0 與浮點誤差（存檔時讓數字好讀）。

```ts
console.log(0.1 + 0.2, '→', tidy(0.1 + 0.2));
console.log(-0, '→', tidy(-0));
console.log(Math.sin(Math.PI), '→', tidy(Math.sin(Math.PI)));
```

## writeSceneFile
把實體存成場景檔（例如存檔、編輯器）。`idOf` 決定每個實體在檔案裡的 id。

```ts
const a = world.spawn(Name.with({ value: '樹' }), Transform.at(2, 0, -1));
const b = world.spawn(Name.with({ value: '石頭' }), Transform.at(-1, 0, 0));
const file = writeSceneFile(world, [a, b], { idOf: (e) => world.get(e, Name)?.value });
console.log('存出來的實體：', file.entities.map((e) => `${e.id} ${JSON.stringify(e.components?.Transform)}`));
```

## create
`create.sceneFromFile`：用場景檔建立場景（和 `sceneFromFile` 一樣）。

```ts
const file = parseSceneFile(`<Scene version="1"><Entity id="a"><Transform/></Entity></Scene>`);
scenes.register(create.sceneFromFile('level1', file, { setup: (_w, s) => console.log('建立了', s.entities.size, '個實體') }));
scenes.load('level1');
console.log('目前場景：', scenes.active);
```

## HierarchyKey
系統裡用 `world.requireResource(HierarchyKey)` 取得父子關係（不用 import 場景外掛）。

```ts
const h = world.requireResource(HierarchyKey);
const parent = world.spawn(Transform);
const child = world.spawn(Transform);
h.setParent(child, parent);
console.log('同一個父子關係：', h === hierarchy, '，子物件數：', h.childrenOf(parent).length);
```

## load
`load.sceneFile`：下載並檢查場景檔（和 `loadSceneFile` 一樣）。

```ts
const xml = `<Scene version="1"><Entity id="a" name="A"><Transform/></Entity><Entity id="b" name="B"><Transform/></Entity></Scene>`;
const file = await load.sceneFile(URL.createObjectURL(new Blob([xml])));
console.log('讀到', file.entities.length, '個實體：', file.entities.map((e) => e.name).join('、'));
```

## math
數學小工具：朝向、旋轉、世界座標。這裡讓攝影機一直朝向移動的球。

```ts
spawn.defaultLights(world);
const camera = spawn.camera(world, { position: [0, 3, 6], target: [0, 0, 0] });
const ball = spawn.mesh(world, { geometry: { sphere: 0.4 }, material: '#ff6b6b' });
const box = spawn.mesh(world, { geometry: { box: 0.6 }, material: '#9acd32', position: [0, -1, 0] });
engine.on('update', (t) => {
  const p = world.require(ball, Transform).position;
  p.set(Math.cos(t.elapsed) * 2, 0.5, Math.sin(t.elapsed) * 2);
  math.lookAt(world.require(camera, Transform), math.worldPosition(world.require(ball, Transform)));
  math.setRotation(world.require(box, Transform), [0, t.elapsed, 0]);
});
engine.start();
```

## MeshGeometryKey
取得實體的網格幾何（繪製外掛提供），例如計算碰撞體的大小。

```ts
const e = spawn.mesh(world, { geometry: { box: [2, 1, 1] }, material: '#9acd32' });
engine.start();
engine.timers.after(0.1, () => {
  const g = world.requireResource(MeshGeometryKey).geometryOf(e);
  g?.geometry.computeBoundingBox();
  console.log('網格的範圍：', g?.geometry.boundingBox?.getSize(new Vector3()));
});
```

## Name
實體名稱：編輯器的階層面板顯示，也可以用 `scripts.find('名稱')` 找到實體。

```ts
const e = world.spawn(Name.with({ value: 'Player' }), Transform);
console.log('名稱：', world.require(e, Name).value);
console.log('用名稱找到的是同一個：', scripts.find('Player') === e);
```

## Parent
父節點元件（用 `hierarchy.setParent` 修改，不要直接改）。

```ts
const parent = world.spawn(Transform);
const child = world.spawn(Transform);
hierarchy.setParent(child, parent);
console.log('Parent 元件：', world.get(child, Parent)?.entity === parent);
hierarchy.setParent(child, null);
console.log('脫離之後還有 Parent 嗎？', world.has(child, Parent));
```

## SCENE_FILE_FORMAT
場景檔的格式名稱（JSON 檔的 format 欄位）。

```ts
console.log('場景檔的 format：', SCENE_FILE_FORMAT);
console.log(stringifySceneFile({ format: SCENE_FILE_FORMAT, version: 1, entities: [] }));
```

## SCENE_FILE_VERSION
目前的場景檔版本。

```ts
console.log('目前的場景檔版本：', SCENE_FILE_VERSION);
```

## SCENE_PREVIEW_CHANNEL
3D 場景編輯器和預覽中的遊戲溝通用的頻道名稱（BroadcastChannel）。

```ts
const channel = new BroadcastChannel(SCENE_PREVIEW_CHANNEL);
channel.onmessage = (e) => console.log('收到編輯器的訊息：', (e.data as ScenePreviewMessage).type);
console.log('在頻道', SCENE_PREVIEW_CHANNEL, '上收聽（打開 3D 場景編輯器存檔時會收到）');
```

## SceneCodecsKey
系統裡用 `world.requireResource(SceneCodecsKey)` 取得存讀規則。

```ts
const codecs = world.requireResource(SceneCodecsKey);
console.log('和 scenePlugin.codecs 同一個：', codecs === scenePlugin.codecs);
console.log('Transform 的存讀規則：', codecs.get('Transform')?.type.name);
```

## sceneFile
場景檔的小工具分類：檢查、建立實體、存檔、轉成文字。

```ts
const file = sceneFile.parse(`<Scene version="1"><Entity id="rock"><Transform position="1 0 0"/></Entity></Scene>`);
const spawned = sceneFile.spawn(world, file);
const saved = sceneFile.write(world, [...spawned.entities.values()]);
console.log(sceneFile.stringifyXml(saved));
```

## SceneMember
標記實體屬於哪個場景；卸載場景時一起移除。

```ts
scenes.register({ name: 'level', setup: (w) => void w.spawn(Transform) });
scenes.load('level');
const members = world.query([SceneMember]).entities;
console.log('屬於 level 的實體：', members.length, '，場景：', world.require(members[0], SceneMember).scene);
scenes.unload('level');
console.log('卸載之後：', world.query([SceneMember]).size);
```

## tick
`tick.transforms`：馬上更新世界矩陣（平常每幀自動更新；需要立刻拿到結果時用）。

```ts
const parent = world.spawn(Transform.at(5, 0, 0));
const child = world.spawn(Transform.at(1, 0, 0));
hierarchy.setParent(child, parent);
console.log('更新前的世界座標：', math.worldPosition(world.require(child, Transform)));
tick.transforms(world);
console.log('更新後：', math.worldPosition(world.require(child, Transform)));
```

## Transform
位置、旋轉、縮放。有父物件時是相對於父物件。

```ts
spawn.camera(world, { position: [0, 2, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
const e = spawn.mesh(world, { geometry: { box: 1 }, material: '#ffa94f' });
engine.on('update', (time) => {
  const t = world.require(e, Transform);
  t.position.y = Math.sin(time.elapsed * 2) * 0.5;
  t.scale.setScalar(1 + Math.sin(time.elapsed * 3) * 0.2);
  math.rotate(t, [time.delta, time.delta * 0.5, 0]);
});
engine.start();
```

## TRANSFORM_PRIORITY
變換計算在 lateUpdate 的這個順序執行：比它小的 lateUpdate 系統（例如攝影機跟隨）會先跑。

```ts
console.log('變換計算的順序：', TRANSFORM_PRIORITY);
ecs.addSystem({ name: 'follow', phase: 'lateUpdate', priority: TRANSFORM_PRIORITY - 1, run: () => {} });
console.log('攝影機跟隨放在它前面：', TRANSFORM_PRIORITY - 1);
```

## transformCodec
Transform 的存讀規則：檔案裡的 rotation 用「度」。

```ts
const t = world.add(world.create(), Transform);
t.position.set(1, 2, 3);
math.setRotation(t, [0, Math.PI / 2, 0]);
console.log('存成檔案：', transformCodec.write(t));
```

## transformSystem
更新世界矩陣的系統（場景外掛會自動加入）。

```ts
console.log('系統名稱：', transformSystem.name, '，階段：', transformSystem.phase, '，順序：', transformSystem.priority);
console.log('已經加入了嗎？', ecs.hasSystem(transformSystem.name));
```

## CodecContext
讀檔時給存讀規則的資訊：目前的實體、元件，以及記錄警告的函式。

```ts
const Speed = define.component('Speed', () => ({ value: 1 }));
const codec: ComponentCodec<{ value: number }> = {
  type: Speed,
  read(data, ctx: CodecContext) {
    const v = Number((data as { value?: unknown }).value);
    if (v > 10) ctx.warn(`${ctx.entity} 的速度 ${v} 太快，改成 10`);
    return { value: Math.min(v, 10) };
  },
  write: (s) => s,
};
console.log(codec.read({ value: 99 }, { entity: 'car', component: 'Speed', warn: (m) => console.log('警告：', m) }));
```

## ComponentCodec
自己寫元件的存讀規則：檔案資料和元件資料怎麼轉換。

```ts
const Hp = define.component('Hp', () => ({ current: 100, max: 100 }));
const codec: ComponentCodec<{ current: number; max: number }> = {
  type: Hp,
  read: (data) => ({ max: Number(data), current: Number(data) }), // 檔案裡只寫一個數字
  write: (hp) => hp.max,
};
scenePlugin.codecs.register(codec);
const spawned = spawnSceneFile(world, { format: 'hero-scene', version: 1, entities: [{ id: 'boss', components: { Hp: 500 } }] });
console.log('頭目的血量：', world.require(spawned.entities.get('boss')!, Hp));
```

## ExpandedScene
`expandPrefabs` 的結果：展開後的資料、找不到的預製物件、警告。

```ts
const level = parseSceneFile(`<Scene version="1"><Entity id="x" prefab="prefabs/missing.xml"/></Scene>`);
const result: ExpandedScene = expandPrefabs(level, { missing: 'skip' });
console.log('找不到的預製物件：', result.missing, '，實體數：', result.data.entities.length);
```

## LoadOptions
載入場景的設定：`additive: true` 疊加載入（例如暫停選單疊在遊戲上）。

```ts
scenes.register({ name: 'game', setup: () => {} }, { name: 'pause-menu', setup: () => {} });
scenes.load('game');
const options: LoadOptions = { additive: true };
scenes.load('pause-menu', options);
console.log('載入的場景：', scenes.loadedScenes.join('、'), '，主場景：', scenes.active);
```

## MeshGeometrySource
`MeshGeometryKey` 資源的型別：依實體取得網格幾何。

```ts
const e = spawn.mesh(world, { geometry: { sphere: 1 }, material: '#4cc9f0' });
engine.start();
engine.timers.after(0.1, () => {
  const source: MeshGeometrySource = world.requireResource(MeshGeometryKey);
  const g = source.geometryOf(e);
  console.log('頂點數：', g?.geometry.getAttribute('position').count);
});
```

## PlainCodecOptions
`plainCodec` 的設定：顏色、角度、只能是某些值的欄位、不存的欄位。

```ts
const Light2 = define.component('Light2', () => ({ kind: 'point', color: 0xffffff, cache: 0 }));
const options: PlainCodecOptions<'kind' | 'color' | 'cache'> = { colors: ['color'], choices: { kind: ['point', 'spot'] }, skip: ['cache'] };
const codec = plainCodec(Light2, options);
console.log('存成：', codec.write({ kind: 'spot', color: 0xff8800, cache: 123 }));
try {
  codec.read({ kind: 'laser' }, { entity: 'l', component: 'Light2', warn: console.warn });
} catch (error) {
  console.log('不允許的值：', (error as Error).message);
}
```

## PrefabOverride
預製物件實例可以覆蓋裡面某個實體的名稱或元件。

```ts
const tree = parseSceneFile(`<Scene version="1"><Entity id="tree"><Transform/><Entity id="leaf" name="葉子"><Transform/></Entity></Entity></Scene>`);
const override: PrefabOverride = { name: '紅葉', components: { Transform: { scale: [2, 2, 2] } } };
const { data } = expandPrefabs({ format: 'hero-scene', version: 1, entities: [{ id: 't1', prefab: 'p/tree', overrides: { leaf: override } }], prefabs: { 'p/tree': tree } });
console.log('覆蓋後的葉子：', data.entities.find((e) => e.id === 't1/leaf'));
```

## Scene
場景：`setup` 建立實體，切換時自動移除；`teardown` 清理額外的資源。

```ts
let timer = 0;
const level: Scene = {
  name: 'level',
  setup(w) {
    w.spawn(Transform);
    timer = window.setInterval(() => console.log('level 進行中…'), 400);
  },
  teardown: () => {
    clearInterval(timer);
    console.log('level 卸載，清掉計時器');
  },
};
scenes.register(level);
scenes.load('level');
setTimeout(() => scenes.unload('level'), 1300);
```

## SceneFileData
場景檔的內容：實體、用到的預製物件、場景設定、搭配的介面檔。

```ts
const data: SceneFileData = {
  format: 'hero-scene',
  version: 1,
  settings: { background: '#102030' },
  entities: [{ id: 'cube', name: '方塊', components: { Transform: { position: [0, 1, 0] } } }],
};
console.log(stringifySceneXml(parseSceneFile(data)));
```

## SceneFileEntity
場景檔裡的一個實體：id、名稱、父節點、元件，或是預製物件的實例。

```ts
const entity: SceneFileEntity = { id: 'lamp', name: '路燈', parent: 'street', components: { Transform: { position: [2, 0, 0] } } };
const file = parseSceneFile({ format: 'hero-scene', version: 1, entities: [{ id: 'street' }, entity] });
console.log('父節點：', file.entities[1].parent, '，位置：', file.entities[1].components?.Transform);
```

## SceneFromFileOptions
`sceneFromFile` 的設定：建立後的 setup、卸載時的 teardown、開發時自動重新載入。

```ts
const options: SceneFromFileOptions = {
  setup: (_w, spawned) => console.log('建立了', spawned.entities.size, '個實體'),
  teardown: () => console.log('卸載'),
  hotReload: false,
};
const file = parseSceneFile(`<Scene version="1"><Entity id="a"><Transform/></Entity></Scene>`);
scenes.register(sceneFromFile('s', file, options));
scenes.load('s');
scenes.unload('s');
```

## SceneSettingHandler
場景設定的處理方式：`key` 是 settings 裡的鍵，`apply` 套用並回傳恢復的函式。

```ts
const handler: SceneSettingHandler = {
  key: 'title',
  apply(value, ctx) {
    if (typeof value !== 'string') ctx.warn('title 要是文字');
    const before = document.title;
    document.title = String(value);
    return () => (document.title = before);
  },
};
scenePlugin.codecs.registerSetting(handler);
const { undo } = applySceneSettings(world, { title: '第一關' });
console.log('標題：', document.title);
undo();
```

## SettingContext
套用場景設定時拿到的資訊：場景所在的 world、記錄警告的函式。

```ts
registerSceneSettings(world, [
  {
    key: 'spawnCount',
    apply(value, ctx: SettingContext) {
      const n = Number(value);
      if (n > 5) ctx.warn('太多了，最多 5 個');
      for (let i = 0; i < Math.min(n, 5); i++) ctx.world.spawn(Transform);
      return undefined;
    },
  },
]);
const { warnings } = applySceneSettings(world, { spawnCount: 8 });
console.log('實體數：', world.entityCount, '，警告：', warnings);
```

## SpawnedScene
`spawnSceneFile` 的結果：id → 實體、警告，以及 `add` 替某個 id 的實體加上元件。

```ts
const Spin = define.component('Spin', () => ({ speed: 1 }));
const file = parseSceneFile(`<Scene version="1"><Entity id="wheel"><Transform/></Entity><Entity id="x"><Unknown/></Entity></Scene>`);
const spawned: SpawnedScene = spawnSceneFile(world, file);
spawned.add('wheel', Spin, { speed: 3 });
console.log('wheel 有 Spin 嗎？', world.has(spawned.entities.get('wheel')!, Spin));
console.log('讀檔警告：', spawned.warnings);
```

## TransformComponent
Transform 元件類型，多了 `at(x, y, z)`：建立實體時直接指定位置。

```ts
const T: TransformComponent = Transform;
const e = world.spawn(T.at(1, 2, 3));
console.log('位置：', world.require(e, T).position);
```

## TransformData
Transform 的資料：position、rotation（四元數）、scale，以及計算好的矩陣。

```ts
const t: TransformData = world.add(world.create(), Transform);
t.position.set(0, 1, 0);
t.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
t.scale.set(2, 2, 2);
tick.transforms(world);
console.log('世界矩陣的位置：', new Vector3().setFromMatrixPosition(t.worldMatrix));
```

## WriteSceneOptions
`writeSceneFile` 的設定：每個實體的 id、不能存的元件怎麼處理。

```ts
const e = world.spawn(Name.with({ value: 'door' }), Transform);
const options: WriteSceneOptions = { idOf: (x) => world.get(x, Name)?.value, warn: (m) => console.log('不能存：', m) };
console.log(stringifySceneXml(writeSceneFile(world, [e], options)));
```

## ScenePreviewMessage
3D 場景編輯器和預覽中的遊戲之間的訊息：編輯中的內容、存檔通知、要求內容。

```ts
const messages: ScenePreviewMessage[] = [{ type: 'request' }, { type: 'saved', path: 'scenes/main.xml', reload: true }];
for (const m of messages) console.log(m.type, m.type === 'saved' ? m.path : '');
```
