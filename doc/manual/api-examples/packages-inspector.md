# packages/inspector 的範例

## default
調整面板套件（lil-gui）：自動列出引擎、繪製、後製、物理、音效的常用參數，也能加自己的參數。按 I 顯示／隱藏。

```ts
import inspector from '@engine/packages/inspector';

spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.7, 0.25] }, material: '#9acd32' });
const plugins = new PluginManager(engine, { api: engineApi });
await plugins.install(inspector, { title: '調整', closed: false });
console.log('已安裝：', plugins.list().map((p) => p.name));
engine.start();
```

## InspectorKey
程式取得調整面板：`world.getResource(InspectorKey)`，可以加自己的分類和參數。

```ts
import inspector, { InspectorKey } from '@engine/packages/inspector';

spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
const box = spawn.mesh(world, { geometry: { box: 1 }, material: '#4cc9f0' });
await new PluginManager(engine, { api: engineApi }).install(inspector, { panels: [] });
const panel = world.getResource(InspectorKey)!;
const t = world.require(box, Transform);
const game = panel.folder('方塊');
game.add(t.position, 'y', -1, 1, 0.01).name('高度');
game.add(t.scale, 'x', 0.2, 3, 0.1).name('寬');
engine.start();
```

## Inspector
調整面板：`gui` 是 lil-gui 本身，`folders` 是內建分類，`folder()` 加自己的分類，`show／hide／toggle` 控制顯示，`refresh()` 重新讀值。

```ts
import inspector, { InspectorKey, type Inspector } from '@engine/packages/inspector';

spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
await new PluginManager(engine, { api: engineApi }).install(inspector);
const panel: Inspector = world.getResource(InspectorKey)!;
console.log('內建分類：', Object.keys(panel.folders));
const state = { score: 0 };
panel.folder('遊戲').add(state, 'score').name('分數');
engine.timers.every(0.5, () => {
  state.score += 10;
  panel.refresh(); // 程式改了數值，更新面板
});
engine.timers.after(3, () => (panel.hide(), console.log('3 秒後隱藏，visible =', panel.visible)));
engine.start();
```

## InspectorOptions
安裝時的設定：按鍵、一開始顯示或收合、標題、要顯示的分類、位置、寬度。

```ts
import inspector, { type InspectorOptions } from '@engine/packages/inspector';

spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { sphere: 0.8 }, material: '#ffa94f' });
const options: InspectorOptions = { title: '後製', panels: ['postfx'], position: { top: 8, left: 8 }, width: 220, toggleKey: 'KeyP' };
await new PluginManager(engine, { api: engineApi }).install(inspector, options);
console.log('左上角的面板只有後製分類；按 P 顯示／隱藏');
engine.start();
```

## InspectorPanel
內建分類：engine、render、postfx、physics、audio（沒有對應外掛的會自動略過）。

```ts
import inspector, { InspectorKey, type InspectorPanel } from '@engine/packages/inspector';

const panels: InspectorPanel[] = ['engine', 'physics'];
await new PluginManager(engine, { api: engineApi }).install(inspector, { panels });
console.log('建立的分類：', Object.keys(world.getResource(InspectorKey)!.folders));
engine.start();
```
