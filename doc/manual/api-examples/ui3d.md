# @engine/ui3d 的範例

## UI3DController
面板的控制器（`ui3d.controller`）：建立、更新面板；`panels` 是所有面板的狀態，`reloadPanels` 重新載入介面檔。

```ts
spawn.camera(world, { position: [0, 1.5, 3], target: [0, 1, 0] });
spawn.defaultLights(world);
world.spawn(Transform.at(0, 1, 0), UIPanel3D.with({ xml: `<UI width="300" height="160" padding="16" background="#20304a"><UILabel color="#fff" fontSize="22">3D 面板</UILabel></UI>`, worldWidth: 1.5 }));
engine.start();
engine.timers.after(0.5, () => {
  for (const [e, p] of ui3d.controller.panels) console.log('面板', e, '：', p.width, 'x', p.height, '像素，世界寬', p.worldWidth);
});
```

## UI3DPlugin
3D 介面外掛（`ui3d`）：讓 UIPanel3D 顯示在 3D 空間、可以直接點擊。`setHandlers` 是所有面板共用的事件函式。點面板上的按鈕。

```ts
spawn.camera(world, { position: [0, 1.6, 3], target: [0, 1.2, 0] });
spawn.defaultLights(world);
spawn.grid(world);
const kiosk = world.spawn(Transform.at(0, 1.2, 0), UIPanel3D.with({
  xml: `<UI width="320" height="200" padding="16" gap="10" background="#1b2418" radius="12">
    <UILabel color="#c8f07a" fontSize="22" fontWeight="bold">商店</UILabel>
    <UILabel id="coins" color="#ffd75e">金幣：100</UILabel>
    <UIButton text="買藥水（20）" onClick="buy"/>
  </UI>`,
  worldWidth: 1.6,
}));
let coins = 100;
ui3d.setHandlers({
  buy: () => {
    coins -= 20;
    ui3d.uiOf(kiosk)?.require<UILabel>('coins').setText(`金幣：${coins}`);
    console.log('買了藥水，剩', coins);
  },
});
engine.start();
```

## DEFAULT_PANEL_SIZE
沒有指定尺寸、介面檔也沒寫寬高時，面板的像素大小。

```ts
console.log('預設面板大小：', DEFAULT_PANEL_SIZE);
```

## UI3DKey
系統與腳本用 `world.requireResource(UI3DKey)` 取得 3D 介面外掛。

```ts
console.log('和 ui3d 同一個：', world.requireResource(UI3DKey) === ui3d);
```

## UIPanel3D
3D 介面面板：同樣的 XML、同樣的元件，畫在 3D 平面上。`billboard` 永遠面向攝影機（名牌、血條）。

```ts
spawn.camera(world, { position: [0, 3, 6], target: [0, 1, 0] });
spawn.defaultLights(world);
spawn.grid(world);
for (let i = 0; i < 3; i++) {
  const enemy = spawn.mesh(world, { geometry: { capsule: [0.3, 0.8] }, material: '#ff6b6b', position: [i * 2 - 2, 0.7, 0] });
  const tag = world.spawn(Transform.at(0, 1, 0), UIPanel3D.with({
    xml: `<UI width="160" height="44" padding="6" gap="4" background="rgba(0,0,0,0.6)" radius="8"><UILabel color="#fff" fontSize="14">哥布林 ${i + 1}</UILabel><UIProgressBar value="${30 + i * 30}" height="8" fill="#ff5a5a"/></UI>`,
    worldWidth: 0.9,
    billboard: true,
    interactive: false,
  }));
  hierarchy.setParent(tag, enemy);
}
engine.start();
```

## uiPanel3dCodec
UIPanel3D 在場景檔裡的寫法。

```ts
console.log(uiPanel3dCodec.write({ ...UIPanel3D.create(), src: 'ui/kiosk.xml', worldWidth: 2, billboard: true }));
```

## PanelState
一個面板的執行狀態：介面、貼圖繪製器、three.js 物件、尺寸。

```ts
spawn.camera(world, { position: [0, 1, 3], target: [0, 1, 0] });
const e = world.spawn(Transform.at(0, 1, 0), UIPanel3D.with({ xml: `<UI width="200" height="100" background="#4cc9f0"/>`, worldWidth: 1 }));
engine.start();
engine.timers.after(0.5, () => {
  const p: PanelState | undefined = ui3d.controller.panels.get(e);
  console.log('世界大小', p?.worldWidth, 'x', p?.worldHeight?.toFixed(2), '，介面', p?.ui ? '已載入' : '還沒');
});
```

## UI3DControllerOptions
自己建立 UI3DController 時的設定：共用事件函式、WebGL 繪製器、畫好時的通知。

```ts
const options: UI3DControllerOptions = { handlers: { hi: () => console.log('hi') }, gl: () => render.renderer, onPanelRendered: () => {} };
console.log('設定的鍵：', Object.keys(options));
```

## UI3DHit
`ui3d.hitTest` 的結果：點到哪個面板、面板上的座標、距離。這裡用畫面中央的準心偵測。

```ts
spawn.camera(world, { position: [0, 1, 3], target: [0, 1, 0] });
world.spawn(Transform.at(0, 1, 0), UIPanel3D.with({ xml: `<UI width="300" height="200" background="#20304a" align="center" justify="center"><UILabel color="#fff">準心對著我</UILabel></UI>`, worldWidth: 1.5 }));
engine.start();
engine.timers.after(0.6, () => {
  const hit: UI3DHit | null = ui3d.hitTest(0, 0);
  if (hit) console.log(`打到面板 ${hit.entity}，介面座標 (${hit.x.toFixed(0)}, ${hit.y.toFixed(0)})，距離 ${hit.distance.toFixed(2)}`);
});
```

## UI3DPluginOptions
UI3DPlugin 的設定：共用事件函式、要不要接收瀏覽器滑鼠（關掉後用 `ui3d.pointer` 自己驅動，例如準心、VR 手把）。

```ts
const options: UI3DPluginOptions = { mouse: false, handlers: { ok: () => console.log('ok') } };
console.log('設定：', options);
spawn.camera(world, { position: [0, 1, 3], target: [0, 1, 0] });
world.spawn(Transform.at(0, 1, 0), UIPanel3D.with({ xml: `<UI width="200" height="100" align="center" justify="center"><UIButton text="準心點我" onClick="ok"/></UI>`, worldWidth: 1 }));
ui3d.setHandler('ok', () => console.log('用準心點到了'));
engine.timers.after(0.6, () => {
  ui3d.pointer('down', 0, 0);
  ui3d.pointer('up', 0, 0);
});
engine.start();
```

## UIPanel3DData
UIPanel3D 的資料：來源、像素尺寸、世界寬度、解析度、事件、外觀。用 lil-gui 調整。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [1.5, 1.5, 3], target: [0, 1, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 0.5 }, material: '#ff6b6b', position: [0, 1, -0.6] });
const e = world.spawn(Transform.at(0, 1, 0), UIPanel3D.with({ xml: `<UI width="300" height="180" padding="16" background="#20304a"><UILabel color="#fff" fontSize="24">看板</UILabel></UI>`, worldWidth: 1.5 }));
const p: UIPanel3DData = world.require(e, UIPanel3D);
const gui = new GUI();
gui.add(p, 'worldWidth', 0.5, 3, 0.1).name('世界寬度');
gui.add(p, 'opacity', 0, 1, 0.05).name('不透明度');
gui.add(p, 'billboard').name('面向攝影機');
gui.add(p, 'doubleSided').name('雙面');
gui.add(p, 'depthTest').name('會被遮住');
gui.add(p, 'lit').name('受光照');
engine.start();
```
