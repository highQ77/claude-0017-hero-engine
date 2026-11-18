# @engine/text3d 的範例

## Text3DController
3D 文字的控制器（外掛自動建立）：文字或設定改了就重建。這裡每秒更新計時文字。

```ts
spawn.camera(world, { position: [0, 0, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
const e = world.spawn(Transform, Text3D.with({ text: '0', size: 0.8, color: '#4cc9f0' }));
engine.timers.every(1, () => (world.require(e, Text3D).text = String(Math.floor(engine.time.elapsed))));
console.log('控制器：', text3dPlugin.controller.constructor.name);
engine.start();
```

## Text3DPlugin
3D 文字外掛（手冊的 `text3dPlugin`）。

```ts
console.log('外掛：', text3dPlugin.name, '，依賴：', text3dPlugin.dependencies.join('、'));
```

## BUILTIN_FONT
內建字型（Helvetiker Bold）的名稱，`font` 不填也是用它。只有英文字母、數字與符號；中文請用 `mode: 'flat'`。

```ts
spawn.camera(world, { position: [0, 0, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
world.spawn(Transform, Text3D.with({ text: 'Builtin Font', font: BUILTIN_FONT, size: 0.5, color: '#ffd166' }));
console.log('內建字型：', BUILTIN_FONT);
engine.start();
```

## load
`load.builtinFont`：載入內建的 3D 字型（Font）。

```ts
const font = await load.builtinFont();
console.log('字型名稱：', font.data.familyName, '，有幾個字：', Object.keys(font.data.glyphs).length);
```

## Text3D
3D 文字元件：立體字（extrude）或平面字（flat，可以用中文）。用 lil-gui 調整。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 0.5, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
const e = world.spawn(Transform, Text3D.with({ text: 'HERO', size: 1, depth: 0.3, bevel: true, color: '#ffa94f' }));
const t = world.require(e, Text3D);
const gui = new GUI();
gui.add(t, 'text').name('文字');
gui.add(t, 'mode', ['extrude', 'flat']).name('類型');
gui.add(t, 'size', 0.2, 2, 0.05).name('大小');
gui.add(t, 'depth', 0, 1, 0.05).name('厚度');
gui.add(t, 'bevel').name('斜角');
gui.addColor(t, 'color').name('顏色');
engine.on('update', (time) => math.setRotation(world.require(e, Transform), [0, Math.sin(time.elapsed) * 0.5, 0]));
engine.start();
```

## text3dCodec
Text3D 在場景檔裡的寫法。

```ts
console.log(text3dCodec.write({ ...Text3D.create(), text: 'Score', size: 0.5, color: '#ffcc00' }));
```

## Text3DData
Text3D 的資料。平面文字可以用系統字型、加背景、永遠面向攝影機（名牌、傷害數字）。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 1, 0] });
spawn.defaultLights(world);
const hero = spawn.mesh(world, { geometry: { capsule: [0.3, 0.8] }, material: '#4cc9f0', position: [0, 0.7, 0] });
const label: Partial<Text3DData> = { text: '勇者 Lv.5', mode: 'flat', size: 0.25, fontFamily: 'sans-serif', fontWeight: 'bold', background: '#000000aa', padding: 0.3, billboard: true, anchorY: 'bottom' };
world.spawn(Transform.at(0, 1.4, 0), Text3D.with(label));
engine.on('update', (t) => world.require(hero, Transform).position.set(Math.sin(t.elapsed) * 0.5, 0.7, 0));
engine.start();
```

## CanvasFactory
平面文字用來畫字的畫布（測試時可以換成 OffscreenCanvas）。

```ts
const factory: CanvasFactory = () => new OffscreenCanvas(1, 1);
const canvas = factory();
console.log('建立的畫布：', canvas.constructor.name);
```

## Text3DMode
文字類型：`extrude` 有厚度的立體字，`flat` 平面字（任何字型、中文都可以）。

```ts
spawn.camera(world, { position: [0, 0, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
const modes: Text3DMode[] = ['extrude', 'flat'];
modes.forEach((mode, i) => world.spawn(Transform.at(0, 0.6 - i * 1.2, 0), Text3D.with({ mode, text: mode === 'flat' ? '平面 flat' : 'Extrude', size: 0.6, color: '#9acd32' })));
engine.start();
```

## create
`create.textShape`：用 3D 字型把文字變成平面形狀（幾何），交給 `spawn.mesh`、`create.mesh`。和 Text3D 元件不同，它只是一個幾何，可以自由搭配材質、著色器。

```ts
spawn.camera(world, { position: [0, 0, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
const font = await load.builtinFont();
const e = spawn.mesh(world, { geometry: create.textShape(font, 'GAME OVER', 0.6), material: { basic: { color: '#ff6b6b', side: 'double' } } });
spawn.mesh(world, { geometry: create.textShape(font, 'press any key', 0.25, { curveSegments: 4 }), material: { basic: { color: '#ffffff' } }, position: [0, -0.8, 0] });
engine.on('update', (t) => world.require(e, Transform).scale.setScalar(1 + Math.sin(t.elapsed * 4) * 0.05));
engine.start();
```
