# @engine/assets 的範例

## AssetGroup
資源群組：記住透過它載入的資源，`releaseAll()` 一次釋放（例如離開一個關卡時）。

```ts
const level = assets.group();
await level.load('textures/checker.png');
await level.load('sounds/jump.wav');
console.log('載入後的引用次數：', assets.refCount('textures/checker.png'));
level.releaseAll();
console.log('releaseAll 之後：', assets.refCount('textures/checker.png'), '，還在嗎？', assets.isLoaded('textures/checker.png'));
```

## AssetManager
資源管理（`assets`）：統一載入、快取與參考計數。同一個網址只會載入一次；用完要 `release`。

```ts
spawn.camera(world, { position: [0, 1.5, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
const tex = await assets.load('textures/checker.png', 'texture');
const again = await assets.load('textures/checker.png', 'texture');
console.log('同一份：', tex === again, '，引用次數：', assets.refCount('textures/checker.png'));
console.log('網址的類型：', assets.resolveType('models/robot.gltf'), assets.resolveType('a.typeface.json'));
spawn.mesh(world, { geometry: { box: 1 }, material: { standard: { map: tex } } });
engine.start();
```

## AssetPlugin
資源外掛（手冊的 `assetPlugin`）：提供 `assets`，並讓 `Model` 元件自動載入模型。

```ts
console.log('外掛：', assetPlugin.name, '，同一個：', assetPlugin.assets === assets);
console.log('有 glTF 載入器嗎？', assets.hasLoader('gltf'), '，有音效載入器嗎？', assets.hasLoader('audio'));
```

## Font
3D 文字的字型（three.js 的 typeface）。`create.textShape` 用它把文字變成平面形狀（幾何），`generateShapes` 取得輪廓本身。

```ts
spawn.camera(world, { position: [0, 0, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
const font: Font = await load.builtinFont();
const shapes = font.generateShapes('HERO', 1);
const geometry = create.textShape(font, 'HERO', 1);
spawn.mesh(world, { geometry, material: { basic: { color: '#ffd166', side: 'double' } } });
console.log('字型：', font.data.familyName, '，形狀數：', shapes.length);
engine.start();
```

## ModelController
模型載入控制器（外掛自動建立）：網址改變時重新載入，載入完成後加上 SceneObject。點畫面換模型。

```ts
spawn.camera(world, { position: [2, 2, 4], target: [0, 0.8, 0] });
spawn.defaultLights(world);
const e = world.spawn(Transform, Model.with({ url: 'models/robot.gltf' }));
addEventListener('pointerdown', () => {
  const m = world.require(e, Model);
  m.url = m.url ? '' : 'models/robot.gltf';
  console.log(m.url ? '載入模型' : '移除模型');
});
engine.on('update', () => {
  const m = world.require(e, Model);
  if (engine.time.frame % 30 === 0) console.log('狀態：', m.status, '，有 SceneObject：', world.has(e, SceneObject));
});
engine.start();
```

## AssetsKey
系統裡用 `world.requireResource(AssetsKey)` 取得資源管理。

```ts
console.log('和 assets 同一個：', world.requireResource(AssetsKey) === assets);
```

## Model
模型元件：給 glTF 網址就會自動載入、顯示。搭配 `Animator` 播放模型的動畫。用 lil-gui 切換動畫。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [2, 2, 4], target: [0, 0.8, 0] });
spawn.defaultLights(world, { shadows: true });
spawn.mesh(world, { geometry: { plane: 6 }, material: '#777777', rotation: [-Math.PI / 2, 0, 0], receiveShadow: true });
const robot = world.spawn(Transform, Model.with({ url: 'models/robot.gltf', castShadow: true }), Animator.with({ play: 'Idle' }));
const anim = world.require(robot, Animator);
const gui = new GUI();
gui.add(anim, 'play', ['Idle', 'Wave', 'Spin']).name('動畫');
gui.add(anim, 'speed', 0, 3, 0.1).name('速度');
engine.timers.after(0.5, () => console.log('模型的動畫：', world.require(robot, Model).animations.map((a) => a.name)));
engine.start();
```

## MODEL_PRIORITY
套用模型載入結果的順序（update 階段最前面），同一幀的其他系統就看得到。

```ts
console.log('模型：', MODEL_PRIORITY);
```

## modelCodec
Model 在場景檔裡的寫法（網址相對於 public/）。

```ts
console.log(modelCodec.write({ ...Model.create(), url: 'models/robot.gltf', castShadow: true }));
```

## object3d
three.js 物件的小工具：`instantiate` 複製載入的模型（共用幾何與材質，很省），`dispose` 釋放。

```ts
spawn.camera(world, { position: [0, 4, 7], target: [0, 0.5, 0] });
spawn.defaultLights(world);
const gltf = await assets.load('models/robot.gltf', 'gltf');
for (let i = 0; i < 5; i++) {
  const copy = object3d.instantiate(gltf.scene);
  world.spawn(Transform.at(i * 1.5 - 3, 0, 0), SceneObject.with({ object: copy }));
}
console.log('複製了 5 個機器人（共用幾何與材質）');
engine.start();
```

## register
`register.defaultLoaders`：替自己建立的 AssetManager 註冊內建的載入器。

```ts
const mine = new AssetManager();
console.log('註冊前有圖片載入器嗎？', mine.hasLoader('texture'));
register.defaultLoaders(mine);
console.log('註冊後：', mine.hasLoader('texture'), mine.hasLoader('gltf'), mine.hasLoader('audio'));
const text = await mine.load('ui/theme.xml', 'text');
console.log('讀到的文字：', text.slice(0, 40), '…');
```

## AssetLoader
自己寫載入器：對應的副檔名、怎麼載入、怎麼釋放。這裡做一個讀 .csv 變成二維陣列的載入器。

```ts
const csvLoader: AssetLoader<string[][]> = {
  extensions: ['.csv'],
  async load(url) {
    const text = await (await fetch(url)).text();
    return text.trim().split('\n').map((row) => row.split(','));
  },
  dispose: () => console.log('釋放 csv'),
};
assets.registerLoader('csv', csvLoader);
const url = URL.createObjectURL(new Blob(['名稱,攻擊\n劍,10\n斧,14']));
const table = await assets.load(url, 'csv');
console.log(table);
assets.release(url, 'csv');
```

## AssetManagerOptions
`new AssetManager(options)` 的設定：`baseUrl` 是相對網址的前綴。

```ts
const options: AssetManagerOptions = { baseUrl: '/cdn/game/' };
const mine = new AssetManager(options);
console.log(mine.resolveUrl('textures/wood.png'));
```

## AssetPluginOptions
`new AssetPlugin(options)` 的設定：baseUrl、不註冊內建載入器、內建載入器的設定。

```ts
const options: AssetPluginOptions = { baseUrl: '/assets/', noDefaultLoaders: false };
console.log('設定：', options, '，手冊目前的 baseUrl：', JSON.stringify(assets.baseUrl));
```

## AssetProgress
載入進度：已完成、總數、失敗。做讀取畫面用。

```ts
assets.onProgress((p: AssetProgress, url) => console.log(`${p.loaded}/${p.total}（失敗 ${p.failed}）`, url));
await assets.preload(['textures/checker.png', 'sounds/jump.wav', 'sounds/pop.wav', 'models/robot.gltf']).catch(() => {});
console.log('全部完成：', assets.progress);
```

## AssetTypeMap
資源類型 → 載入後的型別：`assets.load(網址, 'texture')` 的結果就是 Texture。

```ts
const tex: AssetTypeMap['texture'] = await assets.load('textures/checker.png', 'texture');
const sound: AssetTypeMap['audio'] = await assets.load('sounds/pop.wav', 'audio');
console.log('貼圖', tex.width, 'x', tex.height, '；音效', sound.duration.toFixed(2), '秒');
```

## DefaultLoaderOptions
內建載入器的設定（例如 glTF 的 Draco 解碼器位置）。

```ts
const options: DefaultLoaderOptions = {};
const mine = new AssetManager();
register.defaultLoaders(mine, options);
console.log('註冊了這些類型：', ['texture', 'gltf', 'audio', 'json', 'text', 'font'].filter((t) => mine.hasLoader(t)));
```

## GLTF
glTF 載入的結果：場景、動畫片段、攝影機。

```ts
const gltf: GLTF = await assets.load('models/robot.gltf', 'gltf');
console.log('動畫：', gltf.animations.map((a) => `${a.name}（${a.duration} 秒）`));
const names: string[] = [];
gltf.scene.traverse((o) => o.name && names.push(o.name));
console.log('節點：', names.join('、'), '，產生器：', gltf.asset.generator);
```

## ModelData
Model 的資料：網址、陰影；status、error、animations 由系統填寫。

```ts
const e = world.spawn(Transform, Model.with({ url: 'models/robot.gltf' }));
const bad = world.spawn(Transform, Model.with({ url: 'models/not-found.gltf' }));
engine.start();
engine.timers.after(1, () => {
  const m: ModelData = world.require(e, Model);
  console.log('robot：', m.status, '，動畫', m.animations.length, '個');
  console.log('not-found：', world.require(bad, Model).status, world.require(bad, Model).error?.message.slice(0, 40));
});
```

## AssetType
資源種類：texture、audio、gltf、json、text…，也可以是自己註冊的種類。

```ts
const types: AssetType[] = ['texture', 'json', 'my-format'];
for (const t of types) console.log(t, '有載入器嗎？', assets.hasLoader(t));
```

## ModelStatus
模型的狀態：尚未載入、載入中、可以使用、載入失敗。

```ts
const e = world.spawn(Transform, Model.with({ url: 'models/robot.gltf' }));
const seen: ModelStatus[] = [];
engine.on('update', () => {
  const s = world.require(e, Model).status;
  if (seen.at(-1) !== s) console.log('狀態：', seen[seen.push(s) - 1]);
});
engine.start();
```

## ProgressListener
載入進度的監聽函式：每個資源完成或失敗時呼叫。回傳取消的函式。

```ts
const listener: ProgressListener = (p, url) => console.log(`${Math.round((p.loaded / p.total) * 100)}%`, url);
const off = assets.onProgress(listener);
await assets.preload(['sounds/jump.wav', 'sounds/bounce.wav']);
off();
```
