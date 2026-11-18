# @engine/input 的範例

## ActionMap
動作對應（`input.actions`）：把「跳躍」「移動」對應到好幾個按鍵與手把，遊戲邏輯只看動作。點一下畫面，再用 WASD／方向鍵移動、空白鍵跳。

```ts
spawn.camera(world, { position: [0, 4, 7], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.grid(world);
const box = spawn.mesh(world, { geometry: { box: 0.8 }, material: '#4cc9f0', position: [0, 0.4, 0] });
input.actions
  .bindAxis('moveX', { negative: ['KeyA', 'ArrowLeft'], positive: ['KeyD', 'ArrowRight'], padAxis: GamepadAxis.LeftX })
  .bindAxis('moveZ', { negative: ['KeyW', 'ArrowUp'], positive: ['KeyS', 'ArrowDown'], padAxis: GamepadAxis.LeftY })
  .bind('jump', ['Space', 'Pad:A']);
let vy = 0;
engine.on('update', (t) => {
  const p = world.require(box, Transform).position;
  p.x += input.actions.axis('moveX') * t.delta * 4;
  p.z += input.actions.axis('moveZ') * t.delta * 4;
  if (input.actions.wasPressed('jump') && p.y <= 0.41) vy = 6;
  vy -= 20 * t.delta;
  p.y = Math.max(0.4, p.y + vy * t.delta);
});
console.log('jump 綁定：', input.actions.bindingsOf('jump'));
engine.start();
```

## ButtonSet
一組按鍵的狀態（鍵盤、滑鼠、手把按鈕各一組）：按著、這一幀按下、這一幀放開。

```ts
const keys = new ButtonSet();
keys.press('KeyA');
console.log('按著 A？', keys.isDown('KeyA'), '，剛按下？', keys.wasPressed('KeyA'));
keys.press('KeyB');
console.log('按著的：', [...keys.held]);
keys.releaseAll();
console.log('全部放開之後：', [...keys.held], '，A 剛放開？', keys.wasReleased('KeyA'));
```

## GamepadState
一支手把的狀態：搖桿、板機、按鈕。接上手把按任意鍵就會顯示。

```ts
engine.on('update', () => {
  const pad: GamepadState | undefined = input.gamepad;
  if (!pad || engine.time.frame % 20) return;
  const pressed = Object.entries(GamepadButton).filter(([, i]) => pad.buttons.isDown(String(i))).map(([n]) => n);
  console.log(pad.id.slice(0, 20), '左搖桿', pad.axes[0]?.toFixed(2), pad.axes[1]?.toFixed(2), '按著', pressed.join(' '));
});
console.log('接上手把並按一個按鈕（沒有手把就不會顯示）');
engine.start();
```

## Input
輸入狀態（`input`）：鍵盤、滑鼠、觸控、手把。綁定字串：`'KeyW'`、`'Mouse:Left'`、`'Pad:A'`。移動滑鼠、按住左鍵看看。

```ts
world.remove(spawn.camera(world, { position: [0, 0, 5], target: [0, 0, 0] }), OrbitControl);
spawn.defaultLights(world);
const ball = spawn.mesh(world, { geometry: { sphere: 0.3 }, material: '#ffd166' });
engine.on('update', () => {
  const p = world.require(ball, Transform).position;
  p.set(input.pointer.ndcX * 3, input.pointer.ndcY * 2, 0);
  world.require(ball, MeshRenderer).material = input.isDown('Mouse:Left') ? '#ff6b6b' : '#ffd166';
  if (input.wasPressed('Mouse:Left')) console.log('按下，位置', input.pointer.x.toFixed(0), input.pointer.y.toFixed(0));
});
engine.start();
```

## InputPlugin
輸入外掛把瀏覽器的事件接到 `input`（手冊的 `inputPlugin` 已經裝好）。也負責指標鎖定（第一人稱視角）。點畫面鎖定滑鼠，按 Esc 離開。

```ts
spawn.defaultLights(world);
spawn.grid(world, { size: 20, divisions: 20 });
for (let i = 0; i < 8; i++) spawn.mesh(world, { geometry: { box: 1 }, material: '#9acd32', position: [Math.cos(i) * 6, 0.5, Math.sin(i) * 6] });
const camera = spawn.camera(world, { position: [0, 1.6, 0] });
world.remove(camera, OrbitControl);
let yaw = 0;
let pitch = 0;
render.renderer.domElement.addEventListener('click', () => inputPlugin.requestPointerLock());
engine.on('update', () => {
  if (!input.pointer.locked) return;
  yaw -= input.pointer.deltaX * 0.003;
  pitch = MathUtils.clamp(pitch - input.pointer.deltaY * 0.003, -1.4, 1.4);
  world.require(camera, Transform).rotation.setFromEuler(new Euler(pitch, yaw, 0, 'YXZ'));
});
console.log('外掛：', inputPlugin.name, '，同一個輸入：', inputPlugin.input === input);
engine.start();
```

## PointerState
主要指標（滑鼠或第一根手指）的位置、移動量、滾輪；`active` 是所有按下中的指標（多點觸控）。

```ts
engine.on('update', () => {
  const p: PointerState = input.pointer;
  if (p.wheel) console.log('滾輪', p.wheel);
  if (p.active.size && engine.time.frame % 15 === 0)
    console.log(`按下中 ${p.active.size} 個；位置 (${p.x.toFixed(0)}, ${p.y.toFixed(0)})，ndc (${p.ndcX.toFixed(2)}, ${p.ndcY.toFixed(2)})`);
});
console.log('在畫面上按住拖曳、或捲動滾輪');
engine.start();
```

## GamepadAxis
標準手把的軸編號：左搖桿 X／Y、右搖桿 X／Y（Y 往上是負的）。

```ts
console.log(GamepadAxis);
input.actions.bindAxis('lookX', { padAxis: GamepadAxis.RightX });
input.actions.bindAxis('moveY', { padAxis: GamepadAxis.LeftY, invertPad: true }); // 讓往上為正
console.log('沒有手把時：', input.actions.axis('lookX'));
```

## GamepadButton
標準手把的按鈕編號（W3C Standard Gamepad）。綁定時寫名稱：`'Pad:A'`。

```ts
console.log('A =', GamepadButton.A, '，Start =', GamepadButton.Start, '，十字鍵上 =', GamepadButton.Up);
input.actions.bind('pause', ['Escape', 'Pad:Start']);
console.log('pause 的綁定：', input.actions.bindingsOf('pause'));
```

## INPUT_PRIORITY
輸入在每幀 input 階段最前面結算，所以其他系統拿到的都是這一幀的狀態。

```ts
console.log('輸入結算的順序：', INPUT_PRIORITY);
ecs.addSystem({ name: 'read-input', phase: 'input', run: () => {} }); // 預設 0，在結算之後
```

## InputKey
系統裡用 `world.requireResource(InputKey)` 取得輸入狀態。

```ts
const i = world.requireResource(InputKey);
console.log('和 input 同一個：', i === input);
i.keyDown('KeyJ');
i.update();
console.log('模擬按下 J：', input.isDown('KeyJ'), input.wasPressed('KeyJ'));
```

## AxisDefinition
軸的綁定：負方向、正方向的按鍵，以及手把搖桿。這裡模擬按鍵看數值。

```ts
const def: AxisDefinition = { negative: ['KeyA'], positive: ['KeyD'], padAxis: GamepadAxis.LeftX };
input.actions.bindAxis('steer', def);
input.keyDown('KeyD');
input.update();
console.log('按住 D：', input.actions.axis('steer'));
input.keyDown('KeyA');
input.update();
console.log('兩個都按：', input.actions.axis('steer'));
input.blur();
```

## InputPluginOptions
`new InputPlugin(options)` 的設定：事件的目標元素、右鍵選單、空白鍵與方向鍵捲動頁面。

```ts
const options: InputPluginOptions = { target: document.body, preventContextMenu: true, preventScrollKeys: true, deadzone: 0.2 };
console.log('設定：', options);
console.log('目前的死區：', input.deadzone);
```

## InputStateOptions
`new Input(options)` 的設定：搖桿死區、取得手把的方式（測試時可以給假的手把）。

```ts
const fakePad = { id: '假手把', connected: true, axes: [0.1, -0.9], buttons: [{ pressed: true, value: 1 }] } as unknown as Gamepad;
const options: InputStateOptions = { deadzone: 0.2, getGamepads: () => [fakePad] };
const fake = new Input(options);
fake.update();
console.log('手把：', fake.gamepad?.id, '，軸（0.1 在死區內）：', fake.gamepad?.axes.map((a) => a.toFixed(2)));
console.log('按著 A：', fake.isDown('Pad:A'));
```

## PointerInfo
一個指標（滑鼠或一根手指）：編號、類型、目前位置、按下時的位置。用來做滑動手勢。

```ts
const test = new Input();
test.pointerDown(1, 0, 100, 200, 'touch');
test.pointerMove(180, 190, 800, 600, 80, -10, 1);
const info: PointerInfo | undefined = test.pointer.active.get(1);
if (info) console.log(`${info.type} 從 (${info.startX}, ${info.startY}) 滑到 (${info.x}, ${info.y})，往${info.x > info.startX ? '右' : '左'}滑`);
```

## Binding
綁定字串：鍵盤用 `KeyboardEvent.code`（`'KeyW'`、`'Space'`），滑鼠 `'Mouse:Left'`，手把 `'Pad:A'`。

```ts
const fire: Binding[] = ['KeyJ', 'Mouse:Left', 'Pad:RT'];
input.actions.bind('fire', fire);
engine.on('update', () => input.actions.wasPressed('fire') && console.log('開火！'));
console.log('按 J、點滑鼠左鍵、或手把 RT 開火');
engine.start();
```

## GamepadButtonName
手把按鈕名稱（A、B、X、Y、LB、RB…）。

```ts
const names: GamepadButtonName[] = ['A', 'B', 'LB', 'RT'];
console.log(names.map((n) => `Pad:${n} = 按鈕 ${GamepadButton[n]}`).join('，'));
```

## MouseButtonName
滑鼠按鍵名稱。綁定時寫 `'Mouse:Left'`。

```ts
const buttons: MouseButtonName[] = ['Left', 'Middle', 'Right'];
engine.on('update', () => {
  for (const b of buttons) if (input.wasPressed(`Mouse:${b}`)) console.log('按了滑鼠', b);
});
console.log('在畫面上按滑鼠的左、中、右鍵');
engine.start();
```
