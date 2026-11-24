# @engine/web3d 的範例

## WebPanel3D
3D 網頁面板：把真正的網頁（`src` 用 iframe，或直接給 `html`）放在 3D 空間的平面上。可以捲動、打字、點連結；前面的物體會擋住網頁。

```ts
spawn.camera(world, { position: [0, 1.4, 3], target: [0, 1.2, 0] });
spawn.defaultLights(world);
spawn.grid(world);
world.spawn(
  Transform.at(0, 1.2, 0),
  WebPanel3D.with({
    html: `<div style="padding:24px;font:20px sans-serif">
      <h2 style="margin:0 0 12px">網頁面板</h2>
      <p>這是瀏覽器畫的網頁：可以選取文字、打中文。</p>
      <input placeholder="打字試試看" style="font-size:20px;padding:8px">
    </div>`,
    width: 640,
    height: 360,
    worldWidth: 2,
  }),
);
// 一顆從網頁前面經過的球：前面的物體會蓋住網頁
const ball = spawn.mesh(world, { geometry: { sphere: 0.2 }, material: '#ffb35c', position: [0, 1.2, 0.5] });
engine.timers.every(0, () => {
  world.require(ball, Transform).position.x = Math.sin(engine.time.elapsed) * 1.4;
});
engine.start();
```

## WebPanel3DData
網頁面板的欄位：`src`／`html` 內容、`width`／`height` 排版用的像素、`worldWidth` 世界寬度、`interactive`、`doubleSided`、`background`；`element`、`iframe` 由系統填寫。

```ts
spawn.camera(world, { position: [0, 1.4, 3], target: [0, 1.2, 0] });
spawn.defaultLights(world);
const e = world.spawn(
  Transform.at(0, 1.2, 0),
  WebPanel3D.with({ html: '<h1 style="margin:20px;font-family:sans-serif">只顯示</h1>', width: 480, height: 200, worldWidth: 1.8, interactive: false, background: '#ffe9b0' }),
);
engine.start();
engine.timers.after(0.3, () => {
  const data: WebPanel3DData = world.require(e, WebPanel3D);
  console.log('元素已建立：', data.element !== null, '，世界寬', data.worldWidth, '，可以操作：', data.interactive);
});
```

## WebPanelState
一個網頁面板的執行狀態（`web3d.controller.panels`）：`group` 是 3D 場景裡的群組、`hole` 是挖洞的平面、`css` 是網頁層的物件、`element` 是外層元素。

```ts
spawn.camera(world, { position: [0, 1.4, 3], target: [0, 1.2, 0] });
spawn.defaultLights(world);
world.spawn(Transform.at(0, 1.2, 0), WebPanel3D.with({ html: '<p style="margin:20px">狀態</p>', width: 400, height: 200 }));
engine.start();
engine.timers.after(0.3, () => {
  for (const st of web3d.controller.panels.values() as Iterable<WebPanelState>)
    console.log('實體', st.entity, '：洞', st.hole.visible ? '顯示中' : '隱藏', '，網頁元素', st.element.tagName);
});
```

## WebPanel3DController
網頁面板的控制器（`web3d.controller`）：建立、更新面板；`panels` 是所有面板，`cssScene` 是網頁層的場景，`panelOfHole` 從射線打到的物體找出面板。

```ts
spawn.camera(world, { position: [0, 1.4, 3], target: [0, 1.2, 0] });
spawn.defaultLights(world);
world.spawn(Transform.at(-0.8, 1.2, 0), WebPanel3D.with({ html: '<p style="margin:20px">左</p>', width: 300, height: 200, worldWidth: 1.2 }));
world.spawn(Transform.at(0.8, 1.2, 0), WebPanel3D.with({ html: '<p style="margin:20px">右</p>', width: 300, height: 200, worldWidth: 1.2 }));
engine.start();
engine.timers.after(0.3, () => {
  const c = web3d.controller;
  console.log('面板數：', c.panels.size, '，網頁層的物件：', c.cssScene.children.length);
  const hit = render.pick(0.3, 0); // 畫面中間偏右
  console.log('點到的是網頁嗎：', hit ? c.panelOfHole(hit.object) !== null : false);
});
```

## Web3DPlugin
3D 網頁外掛（`web3d`）：網頁層放在畫布下面、畫布挖洞露出網頁；滑鼠移到露出的網頁上時交給網頁。`activePanel` 是滑鼠所在的面板，`panelAt` 查畫面上某一點露出的面板。

```ts
spawn.camera(world, { position: [0, 1.4, 3], target: [0, 1.2, 0] });
spawn.defaultLights(world);
world.spawn(
  Transform.at(0, 1.2, 0),
  WebPanel3D.with({ html: '<button style="margin:40px;font-size:28px">按我</button>', width: 400, height: 220, worldWidth: 1.6 }),
);
engine.start();
let last: unknown;
engine.timers.every(0.2, () => {
  if (web3d.activePanel === last) return;
  last = web3d.activePanel;
  console.log(last === null ? '滑鼠在遊戲畫面' : `滑鼠在網頁面板 ${String(last)}`);
});
```

## Web3DPluginOptions
外掛的設定：`mouse: false` 時網頁只顯示，滑鼠一律交給遊戲（例如網頁只是看板）。

```ts
const options: Web3DPluginOptions = { mouse: false };
console.log('建立只顯示網頁的外掛：', new Web3DPlugin(options).name);
```

## Web3DKey
從世界取得網頁外掛：`world.requireResource(Web3DKey)`（系統、腳本裡用）。

```ts
spawn.camera(world, { position: [0, 1.4, 3], target: [0, 1.2, 0] });
world.spawn(Transform.at(0, 1.2, 0), WebPanel3D.with({ html: '<p style="margin:20px">Hi</p>', width: 300, height: 160 }));
engine.start();
engine.timers.after(0.3, () => {
  const plugin = world.requireResource(Web3DKey);
  console.log('網頁面板數：', plugin.controller.panels.size);
});
```
