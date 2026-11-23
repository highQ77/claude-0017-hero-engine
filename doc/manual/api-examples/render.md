# @engine/render 的範例

## AdaptiveResolution
動態解析度：畫面跟不上目標 FPS 時降低像素比，流暢時慢慢調回來。這裡用假的幀時間模擬「突然變卡」。

```ts
const ar = new AdaptiveResolution(2, { targetFps: 60, minPixelRatio: 0.6, warmup: 0 });
for (let i = 0; i < 120; i++) {
  const changed = ar.update(i < 60 ? 1 / 60 : 1 / 25); // 後半變成 25 FPS
  if (changed !== null) console.log(`第 ${i} 幀：像素比改成 ${changed.toFixed(2)}（平均 ${ar.averageFrameMs.toFixed(1)} 毫秒）`);
}
console.log('預算', ar.budgetMs.toFixed(1), '毫秒，範圍', ar.min, '~', ar.max);
```

## Binding
綁定讓「某種元件」和「three.js 物件」一對一對應：元件加上時建立、每幀同步、移除時清掉。這裡自己做一個「光環」元件。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
const Halo = define.component('Halo', () => ({ radius: 1, color: '#ffd166' }));
const halos = new Binding(world, render.scene, {
  type: Halo,
  create: (d) => create.mesh({ torus: [1, 0.04] }, { basic: { color: d.color } }),
  update: (mesh, d) => void mesh.scale.setScalar(d.radius),
  dispose: (mesh) => object3d.dispose(mesh),
});
const e = world.spawn(Transform.at(0, 0, 0), Halo);
engine.on('render', (t) => {
  world.require(e, Halo).radius = 1 + Math.sin(t.elapsed * 2) * 0.3;
  halos.sync();
});
engine.start();
```

## BufferGeometry
three.js 的幾何（`create.geometry` 建立的就是它）。描述用 `vertices` 可以自己給頂點，做出任意形狀；這裡做一個三色的三角形。

```ts
spawn.camera(world, { position: [0, 0, 3], target: [0, 0, 0] });
const geometry: BufferGeometry = create.geometry({
  vertices: [-1, -0.8, 0, 1, -0.8, 0, 0, 1, 0],
  colors: [1, 0, 0, 0, 1, 0, 0, 0, 1],
});
spawn.mesh(world, { geometry, material: { basic: { vertexColors: true, side: 'double' } } });
console.log('頂點數：', geometry.getAttribute('position').count);
engine.start();
```

## CameraRig
攝影機跟隨與晃動的控制器（繪製外掛自動建立）。平常用 `CameraFollow`、`shakeCamera`，傳送之後用 `render.snapCamera` 直接跳過去。點畫面讓球傳送。

```ts
spawn.defaultLights(world);
spawn.grid(world, { size: 20, divisions: 20 });
const ball = spawn.mesh(world, { geometry: { sphere: 0.4 }, material: '#ff6b6b', position: [0, 0.4, 0] });
const camera = spawn.camera(world, { position: [0, 3, 6] });
world.add(camera, CameraFollow, { target: ball, offset: new Vector3(0, 3, 6), smoothTime: 0.5 });
world.remove(camera, OrbitControl);
addEventListener('pointerdown', () => {
  world.require(ball, Transform).position.x = Math.random() * 10 - 5;
  render.snapCamera(camera); // 不慢慢滑過去，直接跳到
  console.log('傳送！');
});
engine.on('update', (t) => (world.require(ball, Transform).position.z = Math.sin(t.elapsed) * 3));
engine.start();
```

## DebugDraw
除錯繪製（`render.debug`）：線、射線、方框、球、點、路徑。沒給 `duration` 只畫這一幀，給秒數就畫那麼久。

```ts
spawn.camera(world, { position: [4, 4, 6], target: [0, 0, 0] });
render.debug.line([-2, 0, 0], [2, 0, 0], { color: '#ff6b6b', duration: 999 });
render.debug.box([0, 0.5, 0], 1, { color: '#4cc9f0', duration: 999 });
render.debug.sphere([2, 1, 0], 0.5, { duration: 999 });
render.debug.point([-2, 1, 0], 0.3, { color: '#ffd166', duration: 999 });
engine.on('update', (t) => render.debug.ray([0, 0, 0], [Math.cos(t.elapsed), 1, Math.sin(t.elapsed)], 2, { color: '#ffffff' }));
engine.start();
```

## LayerNames
繪製圖層（`render.layers`）：名稱第一次用到時自動配一個編號，`'default'` 是 0。小地圖、只有某台攝影機看得到的物件用。

```ts
const bit = render.layers.bit('minimap');
console.log('minimap 的編號：', bit, '，default：', render.layers.bit('default'));
console.log('合起來的 mask：', render.layers.mask(['default', 'minimap']).toString(2));
console.log('已用到的圖層：', render.layers.names());
```

## Material
所有 three.js 材質的基礎類別：透明、雙面、深度測試等共用的設定。

```ts
spawn.camera(world, { position: [0, 1, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const e = spawn.mesh(world, { geometry: { sphere: 0.8 }, material: '#4cc9f0' });
engine.start();
engine.on('update', (t) => {
  const mat = (render.getObject(e) as Mesh | undefined)?.material as Material | undefined;
  if (!mat) return;
  mat.transparent = true;
  mat.opacity = 0.3 + 0.7 * Math.abs(Math.sin(t.elapsed));
});
```

## MeshBasicMaterial
不受光照的材質：純色、介面、發光特效。即使沒有燈光也看得到。用描述 `{ basic: {…} }`；需要自己修改時用 `create.material` 建立（不共用）。

```ts
spawn.camera(world, { position: [0, 1, 4], target: [0, 0, 0] });
const ring: MeshBasicMaterial = create.material({ basic: { color: '#ffd166', wireframe: true } });
spawn.mesh(world, { geometry: { torus: [0.8, 0.25] }, material: ring });
spawn.mesh(world, { geometry: { sphere: 0.4 }, material: { basic: { color: '#ff6b6b' } } }); // 直接寫描述（共用）
engine.on('update', (t) => ring.color.setHSL((t.elapsed * 0.2) % 1, 0.8, 0.6));
engine.start();
```

## MeshPhysicalMaterial
進階 PBR 材質：透明的玻璃（transmission）、清漆（clearcoat）。用 lil-gui 調整。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 1, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 0.6 }, material: '#ff6b6b', position: [0, 0, -1.5] });
const glass: MeshPhysicalMaterial = create.material({ physical: { color: '#ffffff', roughness: 0.05, transmission: 1, thickness: 0.5 } });
spawn.mesh(world, { geometry: { sphere: 0.8 }, material: glass });
const gui = new GUI();
gui.add(glass, 'transmission', 0, 1, 0.01).name('穿透');
gui.add(glass, 'roughness', 0, 1, 0.01).name('粗糙度');
gui.add(glass, 'clearcoat', 0, 1, 0.01).name('清漆');
engine.start();
```

## MeshStandardMaterial
最常用的 PBR 材質：顏色、粗糙度、金屬感、自發光。用 lil-gui 調整看看。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 1, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const mat: MeshStandardMaterial = create.material({ standard: { color: '#c0a060', roughness: 0.4, metalness: 0.8 } });
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: mat });
const gui = new GUI();
gui.addColor(mat, 'color').name('顏色');
gui.add(mat, 'roughness', 0, 1, 0.01).name('粗糙度');
gui.add(mat, 'metalness', 0, 1, 0.01).name('金屬感');
gui.addColor(mat, 'emissive').name('自發光');
engine.start();
```

## Object3D
three.js 所有物件的基礎類別（`create.mesh`、`create.group` 建立的都是）。用 `SceneObject` 元件把自己組的物件放進場景，跟著實體移動。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
const group: Object3D = create.group();
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  group.add(create.mesh({ box: 0.3 }, '#9acd32', { position: [Math.cos(a), 0, Math.sin(a)] }));
}
const e = world.spawn(Transform, SceneObject.with({ object: group }));
engine.on('update', (t) => math.rotate(world.require(e, Transform), [0, t.delta, 0]));
console.log('子物件數：', group.children.length);
engine.start();
```

## OrbitController
處理拖曳、滾輪，並更新有 `OrbitControl` 的攝影機（繪製外掛自動建立；手冊預設開啟）。這裡把自動旋轉打開，拖曳試試看。

```ts
spawn.defaultLights(world);
spawn.grid(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#ffa94f', position: [0, 0.5, 0] });
const camera = spawn.camera(world, { position: [0, 3, 6], target: [0, 0.5, 0] });
world.add(camera, OrbitControl, { autoRotate: 0.6, damping: 0.2, target: new Vector3(0, 0.5, 0) });
console.log('拖曳轉動、滾輪縮放、右鍵平移；手放開後自動旋轉');
engine.start();
```

## isWebGPURenderer
判斷繪製器是不是 WebGPURenderer（測試用的替身繪製器不是）。實際用 WebGPU 還是 WebGL2 備援看 `render.gpuApi`。

```ts
await render.ready;
console.log('是 WebGPURenderer 嗎？', isWebGPURenderer(render.renderer));
console.log('實際的圖形介面：', render.gpuApi);
```

## RenderPlugin
繪製外掛（`render`）：把網格、攝影機、燈光畫出來。也提供點選（`pick`）、畫面大小、取得 three.js 物件。點畫面上的方塊看看。

```ts
spawn.camera(world, { position: [0, 3, 6], target: [0, 0, 0] });
spawn.defaultLights(world);
for (let i = 0; i < 4; i++) spawn.mesh(world, { geometry: { box: 0.8 }, material: '#9acd32', position: [i * 1.5 - 2.25, 0, 0], name: `方塊${i + 1}` });
render.renderer.domElement.addEventListener('pointerdown', (ev) => {
  const rect = render.renderer.domElement.getBoundingClientRect();
  const hit = render.pick(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  if (!hit) return console.log('沒點到');
  console.log('點到', world.get(hit.entity, Name)?.value, '，距離', hit.distance.toFixed(2));
  world.require(hit.entity, MeshRenderer).material = '#ff6b6b';
});
console.log('畫面大小：', render.size, '，寬高比', render.aspect.toFixed(2));
engine.start();
```

## RenderResources
用描述建立的幾何、材質會共用（內容一樣就同一份），用參考計數管理（`render.resources`）。

```ts
for (let i = 0; i < 50; i++) spawn.mesh(world, { geometry: { box: 1 }, material: '#ff8800' });
spawn.mesh(world, { geometry: { sphere: 1 }, material: '#ff8800' });
engine.start();
engine.timers.after(0.1, () => console.log('51 個網格，實際的資源：', render.resources.stats));
```

## Texture
貼圖：`create.texture` 可以給網址載入圖檔，也可以給畫布。這裡用畫布畫一張棋盤格，`pixelated` 讓放大時不模糊。

```ts
spawn.camera(world, { position: [0, 1.5, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
const c = document.createElement('canvas');
c.width = c.height = 64;
const g = c.getContext('2d')!;
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  g.fillStyle = (x + y) % 2 ? '#ffffff' : '#ff6b6b';
  g.fillRect(x * 8, y * 8, 8, 8);
}
const tex: Texture = create.texture(c, { pixelated: true });
const e = spawn.mesh(world, { geometry: { box: 1 }, material: { standard: { map: tex } } });
engine.on('update', (t) => math.rotate(world.require(e, Transform), [0, t.delta, 0]));
engine.start();
```

## registerMaterialType
登記自訂的材質描述：描述裡用這個鍵時，交給你的函式建立材質。這裡做一個 `{ glow: 顏色 }`：不受光照、疊加發亮的材質。

```ts
const off = registerMaterialType('glow', (color) => create.material({ basic: { color: String(color), blending: 'additive', transparent: true, opacity: 0.8 } }));
spawn.camera(world, { position: [0, 1, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: { glow: '#4cc9f0' } as unknown as MaterialDesc });
console.log('取消登記的函式：', typeof off);
engine.start();
```

## shakeCamera
讓攝影機晃一下：0.2 輕微、0.5 爆炸、1 很大，可以疊加。點畫面晃動，用 lil-gui 調整強度。

```ts
import GUI from 'lil-gui';

spawn.defaultLights(world);
spawn.grid(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#ffa94f', position: [0, 0.5, 0] });
const camera = spawn.camera(world, { position: [0, 3, 6], target: [0, 0.5, 0] });
world.remove(camera, OrbitControl);
const params = { amount: 0.5, shake: () => shakeCamera(world, camera, params.amount) };
const gui = new GUI();
gui.add(params, 'amount', 0, 1, 0.05).name('強度');
gui.add(params, 'shake').name('晃一下');
render.renderer.domElement.addEventListener('pointerdown', params.shake);
engine.start();
```

## Camera
攝影機元件（通常用 `spawn.camera` 建立）：視角、遠近、正交或透視。用 lil-gui 調整視角。

```ts
import GUI from 'lil-gui';

spawn.defaultLights(world);
for (let i = 0; i < 5; i++) spawn.mesh(world, { geometry: { box: 0.8 }, material: '#9acd32', position: [0, 0, -i * 2] });
const camera = spawn.camera(world, { position: [0, 1, 4], target: [0, 0, -2] });
const data = world.require(camera, Camera);
const gui = new GUI();
gui.add(data, 'fov', 15, 120, 1).name('視角（度）');
gui.add(data, 'far', 2, 20, 0.5).name('最遠距離');
gui.add(data, 'kind', ['perspective', 'orthographic']).name('種類');
gui.add(data, 'size', 1, 10, 0.1).name('正交的半高');
engine.start();
```

## cameraCodec
Camera 在場景檔裡的寫法。

```ts
console.log('存成：', cameraCodec.write({ ...Camera.create(), fov: 50, kind: 'orthographic' }));
console.log('讀回：', cameraCodec.read({ fov: 70 }, { entity: 'cam', component: 'Camera', warn: console.warn }));
```

## CameraFollow
攝影機跟隨目標：`offset` 相對位置、`smoothTime` 越大越柔和。方向鍵（或 WASD）移動方塊。

```ts
import GUI from 'lil-gui';

spawn.defaultLights(world);
spawn.grid(world, { size: 30, divisions: 30 });
const player = spawn.mesh(world, { geometry: { box: 0.8 }, material: '#4cc9f0', position: [0, 0.4, 0] });
const camera = spawn.camera(world, { position: [0, 3, 6] });
world.remove(camera, OrbitControl);
const follow = world.add(camera, CameraFollow, { target: player, smoothTime: 0.3 });
engine.on('update', (t) => {
  const p = world.require(player, Transform).position;
  const key = (a: string, b: string) => (input.isDown(a) || input.isDown(b) ? 1 : 0);
  p.x += (key('KeyD', 'ArrowRight') - key('KeyA', 'ArrowLeft')) * t.delta * 5;
  p.z += (key('KeyS', 'ArrowDown') - key('KeyW', 'ArrowUp')) * t.delta * 5;
});
const gui = new GUI();
gui.add(follow, 'smoothTime', 0, 2, 0.05).name('平滑時間');
gui.add(follow.offset, 'y', 1, 10, 0.1).name('高度');
gui.add(follow.offset, 'z', 2, 15, 0.1).name('距離');
engine.start();
```

## CameraLayers
攝影機只畫哪些圖層。這裡主攝影機只看 default，小視窗的攝影機另外看得到 `secret` 圖層的球。

```ts
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#9acd32' });
const secret = spawn.mesh(world, { geometry: { sphere: 0.4 }, material: '#ff6b6b', position: [1.2, 0, 0] });
world.add(secret, RenderLayer, { layers: ['secret'] });
spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
const spy = spawn.camera(world, { position: [0, 6, 0.01], target: [0, 0, 0], priority: -1 });
world.add(spy, CameraLayers, { layers: ['default', 'secret'] });
world.add(spy, CameraViewport, { x: 0.68, y: 0.04, width: 0.3, height: 0.4, background: '#20304a' });
engine.start();
```

## cameraLayersCodec
CameraLayers 在場景檔裡的寫法。

```ts
console.log(cameraLayersCodec.write({ layers: ['default', 'minimap'] }));
```

## CameraShake
攝影機晃動的資料（`shakeCamera` 會自動加上）。`decay` 越大停得越快。

```ts
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#ffa94f' });
const camera = spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
world.remove(camera, OrbitControl);
world.add(camera, CameraShake, { decay: 0.3, maxAngle: 6 }); // 停得很慢、晃比較大
engine.timers.every(2, () => shakeCamera(world, camera, 0.8), { immediate: true });
engine.on('update', () => {
  const s = world.get(camera, CameraShake);
  if (s && engine.time.frame % 30 === 0) console.log('晃動量', s.trauma.toFixed(2));
});
engine.start();
```

## CameraViewport
把攝影機畫在畫面的一塊範圍（小地圖、子母畫面）。位置大小都是 0~1 的比例。

```ts
spawn.defaultLights(world);
spawn.grid(world);
const ball = spawn.mesh(world, { geometry: { sphere: 0.4 }, material: '#ff6b6b', position: [0, 0.4, 0] });
spawn.camera(world, { position: [0, 3, 6], target: [0, 0, 0] });
const top = spawn.camera(world, { position: [0, 12, 0.01], target: [0, 0, 0], priority: -1 });
world.add(top, CameraViewport, { x: 0.02, y: 0.02, width: 0.28, height: 0.4, background: '#1a1a2e' });
engine.on('update', (t) => world.require(ball, Transform).position.set(Math.cos(t.elapsed) * 3, 0.4, Math.sin(t.elapsed) * 3));
engine.start();
```

## cameraViewportCodec
CameraViewport 在場景檔裡的寫法。

```ts
const data = { ...CameraViewport.create(), x: 0.7, y: 0, width: 0.3, height: 0.3, background: '#000000' };
console.log(cameraViewportCodec.write(data));
```

## create
建立 three.js 物件的小工具（不共用，可以自由修改）：幾何、材質、貼圖。

```ts
spawn.camera(world, { position: [0, 1, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const geometry = create.geometry({ capsule: [0.4, 0.8] });
const material = create.material({ standard: { color: '#ff8800', roughness: 0.3 } });
spawn.mesh(world, { geometry, material });
engine.on('update', (t) => material.color.setHSL((t.elapsed * 0.1) % 1, 0.8, 0.5));
console.log('材質類別：', material.type);
engine.start();
```

`create.mesh`、`create.group`、`create.points`：自己組一個模型（不用 import three），交給 `SceneObject` 跟著實體移動。這裡組一棵樹和一片螢火蟲。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 1, 0] });
spawn.defaultLights(world);
const tree = create.group(
  { name: 'tree' },
  create.mesh({ cylinder: [0.12, 1] }, '#8b5a2b', { position: [0, 0.5, 0] }),
  create.mesh({ cone: [0.6, 1.2] }, '#3f9b45', { position: [0, 1.4, 0] }),
  create.mesh({ cone: [0.45, 0.9] }, '#4caf50', { position: [0, 1.9, 0] }),
);
const fireflies = create.points(
  Array.from({ length: 60 }, () => [Math.random() * 4 - 2, Math.random() * 2 + 0.3, Math.random() * 2 - 1] as [number, number, number]),
  { color: '#fff59d', size: 0.06, blending: 'additive' },
);
world.spawn(Transform, SceneObject.with({ object: tree }));
const swarm = world.spawn(Transform, SceneObject.with({ object: fireflies }));
engine.on('update', (t) => math.setRotation(world.require(swarm, Transform), [0, t.elapsed * 0.3, 0]));
engine.start();
```

## IGNORE_TRANSFORM
在 `object.userData` 標記它，物件就不跟著實體的 Transform（由你自己控制位置）。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
const mesh = create.mesh({ sphere: 0.4 }, '#4cc9f0');
mesh.userData[IGNORE_TRANSFORM] = true;
const e = world.spawn(Transform.at(-2, 0, 0), SceneObject.with({ object: mesh }));
engine.on('update', (t) => {
  world.require(e, Transform).position.x = 999; // 不會影響
  mesh.position.x = Math.sin(t.elapsed) * 2; // 自己控制
});
engine.start();
```

## Light
燈光元件（通常用 `spawn.light` 建立）。用 lil-gui 調整點光源。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 3, 5], target: [0, 0, 0] });
spawn.mesh(world, { geometry: { plane: 8 }, material: '#888888', rotation: [-Math.PI / 2, 0, 0] });
spawn.mesh(world, { geometry: { sphere: 0.6 }, material: '#ffffff', position: [0, 0.6, 0] });
spawn.light(world, { kind: 'ambient', intensity: 0.2 });
const lamp = spawn.light(world, { kind: 'point', color: '#ffaa55', intensity: 8, position: [1.5, 1.5, 1] });
const data = world.require(lamp, Light);
const gui = new GUI();
gui.addColor(data, 'color').name('顏色');
gui.add(data, 'intensity', 0, 30, 0.5).name('亮度');
gui.add(data, 'distance', 0, 10, 0.1).name('照射距離');
engine.start();
```

## lightCodec
Light 在場景檔裡的寫法（顏色是 '#rrggbb'，角度用度）。

```ts
console.log(lightCodec.write({ ...Light.create(), kind: 'spot', color: 0xffcc00, angle: Math.PI / 6 }));
```

`create.attribute`：給幾何加上自訂的頂點資料，著色器裡用 TSL 的 `attribute('名稱')` 讀取。這裡每個頂點存一個高度權重，頂點依時間上下擺動（自訂著色器見 `@engine/shaders`）。

```ts
const { attribute, sin, vec3 } = tsl;
spawn.camera(world, { position: [0, 2, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const geometry = create.geometry({ plane: [3, 3, 30, 30] });
const count = geometry.getAttribute('position').count;
const weight = new Float32Array(count);
for (let i = 0; i < count; i++) weight[i] = Math.random();
geometry.setAttribute('aWeight', create.attribute(weight, 1));
shaders.define({
  name: 'weighted',
  base: 'standard',
  options: { color: '#9acd32', side: 'double' },
  position: (c) => {
    const w = attribute('aWeight', 'float');
    return c.position.add(vec3(0, 0, sin(c.time.mul(3).add(w.mul(6.28))).mul(0.15).mul(w)));
  },
});
spawn.mesh(world, { geometry, material: shaders.createMaterial('weighted'), rotation: [-Math.PI / 2.5, 0, 0] });
console.log('頂點數：', count, '，每個頂點', geometry.getAttribute('aWeight').itemSize, '個數字');
engine.start();
```

## math
`math.toVector3`：把 `[x, y, z]` 或 `{ x, y, z }` 轉成 Vector3。

```ts
console.log(math.toVector3([1, 2, 3]));
console.log(math.toVector3({ x: 4, y: 5, z: 6 }));
const out = new Vector3();
math.toVector3([7, 8, 9], out);
console.log('寫進現有的向量：', out);
```

## MeshRenderer
網格元件：幾何加材質（通常用 `spawn.mesh` 建立）。可以隨時改描述，下一幀就換。點畫面切換形狀。

```ts
spawn.camera(world, { position: [0, 1, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const e = spawn.mesh(world, { geometry: { box: 1 }, material: '#ffa94f' });
const shapes: GeometryDesc[] = [{ box: 1 }, { sphere: 0.7 }, { cone: [0.6, 1.2] }, { torus: [0.6, 0.2] }, { icosahedron: 0.7 }];
let i = 0;
addEventListener('pointerdown', () => {
  world.require(e, MeshRenderer).geometry = shapes[++i % shapes.length];
  console.log('換成', Object.keys(shapes[i % shapes.length])[0]);
});
engine.start();
```

## meshRendererCodec
MeshRenderer 在場景檔裡的寫法。

```ts
const data = { ...MeshRenderer.create(), geometry: { box: [1, 2, 1] }, material: { standard: { color: '#ff8800' } } };
console.log(JSON.stringify(meshRendererCodec.write(data as MeshRendererData)));
```

## ORBIT_CONTROL_PRIORITY
繞轉控制在 lateUpdate 的順序。你的 lateUpdate 系統（預設 0）會先跑。

```ts
console.log('繞轉控制的順序：', ORBIT_CONTROL_PRIORITY, '，變換計算：', TRANSFORM_PRIORITY);
```

## OrbitControl
攝影機繞轉控制：拖曳轉動、滾輪縮放、右鍵平移。用 lil-gui 開關功能、調整速度。

```ts
import GUI from 'lil-gui';

spawn.defaultLights(world);
spawn.grid(world);
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: '#9acd32', position: [0, 1, 0] });
const camera = spawn.camera(world, { position: [0, 3, 6], target: [0, 1, 0] });
const orbit = world.add(camera, OrbitControl, { target: new Vector3(0, 1, 0) });
const gui = new GUI();
gui.add(orbit, 'rotate').name('可以轉動');
gui.add(orbit, 'zoom').name('可以縮放');
gui.add(orbit, 'pan').name('可以平移');
gui.add(orbit, 'autoRotate', 0, 2, 0.1).name('自動旋轉');
gui.add(orbit, 'damping', 0, 1, 0.05).name('慣性');
gui.add(orbit, 'maxDistance', 3, 30, 1).name('最遠距離');
engine.start();
```

## RENDER_DRAW_PRIORITY
實際繪製在 render 階段的順序（最後）。

```ts
console.log('同步：', RENDER_SYNC_PRIORITY, '→ 繪製：', RENDER_DRAW_PRIORITY);
```

## RENDER_SYNC_PRIORITY
把元件同步到 three.js 物件的順序。你的 render 階段系統（預設 0）會先跑，所以在那裡改的資料這一幀就看得到。

```ts
ecs.addSystem({ name: 'before-sync', phase: 'render', priority: RENDER_SYNC_PRIORITY - 1, run: () => {} });
console.log('我的系統在同步（', RENDER_SYNC_PRIORITY, '）之前執行');
```

## RenderKey
系統裡用 `world.requireResource(RenderKey)` 取得繪製外掛。

```ts
const r = world.requireResource(RenderKey);
console.log('和 render 同一個：', r === render, '，畫面大小：', r.size);
```

## RenderLayer
物件所在的繪製圖層。攝影機用 `CameraLayers` 決定要畫哪些。點畫面切換球的圖層（看不見／看得見）。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#9acd32', position: [-1, 0, 0] });
const ball = spawn.mesh(world, { geometry: { sphere: 0.5 }, material: '#ff6b6b', position: [1, 0, 0] });
const layer = world.add(ball, RenderLayer);
addEventListener('pointerdown', () => {
  layer.layers = layer.layers[0] === 'default' ? ['hidden'] : ['default'];
  console.log('球的圖層：', layer.layers);
});
engine.start();
```

## renderLayerCodec
RenderLayer 在場景檔裡的寫法。

```ts
console.log(renderLayerCodec.write({ layers: ['default', 'minimap'] }));
```

## SceneObject
放任意 three.js 物件（載入的模型、自己組的物件），跟著實體的 Transform 移動。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
const points = create.points(
  Array.from({ length: 500 }, () => new Vector3().randomDirection().multiplyScalar(1.5)),
  { color: '#ffd166', size: 0.04 },
);
const e = world.spawn(Transform, SceneObject.with({ object: points }));
engine.on('update', (t) => math.rotate(world.require(e, Transform), [0, t.delta * 0.5, t.delta * 0.2]));
engine.start();
```

## spawn
建立實體的小工具：攝影機、燈光、網格、預設燈光、地面格線、任意實體。

```ts
spawn.camera(world, { position: [3, 3, 5], target: [0, 0.5, 0] });
spawn.defaultLights(world, { intensity: 1.2 });
spawn.grid(world, { size: 6, divisions: 6 });
const base = spawn.entity(world, { position: [0, 0.5, 0], name: '底座' });
spawn.mesh(world, { geometry: { box: 1 }, material: '#ffa94f', parent: base });
spawn.mesh(world, { geometry: { sphere: 0.3 }, material: '#4cc9f0', position: [0, 0.8, 0], parent: base });
spawn.light(world, { kind: 'point', color: '#ff4040', intensity: 5, position: [-1.5, 1, 1] });
engine.on('update', (t) => math.rotate(world.require(base, Transform), [0, t.delta, 0]));
engine.start();
```

## AdaptiveResolutionOptions
動態解析度的設定：目標 FPS、像素比範圍、暖機秒數。

```ts
const options: AdaptiveResolutionOptions = { targetFps: 30, minPixelRatio: 0.5, maxPixelRatio: 1.5, warmup: 0 };
const ar = new AdaptiveResolution(1.5, options);
console.log('每幀預算：', ar.budgetMs.toFixed(1), '毫秒，最低像素比：', ar.min);
```

## BindingSpec
`Binding` 的對應方式：建立、每幀更新、移除。`update` 回傳新物件代表要替換。

```ts
const Marker = define.component('Marker', () => ({ size: 0.3 }));
const spec: BindingSpec<{ size: number }, Mesh> = {
  type: Marker,
  create: (d) => create.mesh({ octahedron: d.size }, { normal: {} }),
  update: (mesh, d) => void mesh.scale.setScalar(d.size / 0.3),
  dispose: () => console.log('移除了一個 Marker'),
};
const binding = new Binding(world, render.scene, spec);
const e = world.spawn(Transform, Marker);
binding.sync();
console.log('對應到的物件：', binding.get(e)?.type);
world.destroy(e);
binding.sync();
```

## CameraData
Camera 元件的資料。`priority` 最高的攝影機負責繪製。點畫面切換兩台攝影機。

```ts
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#9acd32' });
const a = spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0], priority: 1 });
const b = spawn.camera(world, { position: [5, 5, 0], target: [0, 0, 0], kind: 'orthographic', size: 2 });
addEventListener('pointerdown', () => {
  const ca: CameraData = world.require(a, Camera);
  const cb: CameraData = world.require(b, Camera);
  [ca.priority, cb.priority] = [cb.priority, ca.priority];
  console.log('現在用', ca.priority > cb.priority ? '透視攝影機' : '正交攝影機');
});
engine.start();
```

## CameraFollowData
CameraFollow 的資料：目標、相對位置、平滑時間、看向哪裡。

```ts
const data: CameraFollowData = CameraFollow.create();
console.log('預設：offset', data.offset.toArray(), '，smoothTime', data.smoothTime, '，lookOffset', data.lookOffset.toArray());
```

## CameraLayersData
CameraLayers 的資料：這台攝影機畫哪些圖層。

```ts
const data: CameraLayersData = { layers: ['default', 'ui3d'] };
const cam = spawn.camera(world);
world.add(cam, CameraLayers, data);
console.log('攝影機畫的圖層：', world.require(cam, CameraLayers).layers);
```

## CameraShakeData
CameraShake 的資料：目前的晃動量、衰減、最大位移與角度、頻率。

```ts
const data: CameraShakeData = CameraShake.create();
console.log(`預設：decay ${data.decay}、maxOffset ${data.maxOffset} 公尺、maxAngle ${data.maxAngle} 度、frequency ${data.frequency}`);
```

## CameraViewportData
CameraViewport 的資料：位置、大小（0~1）、順序、背景。

```ts
const data: CameraViewportData = { ...CameraViewport.create(), x: 0.5, y: 0.5, width: 0.5, height: 0.5 };
console.log('右下角四分之一：', data);
```

## DebugDrawOptions
除錯繪製的設定：顏色、畫多久、會不會被擋住。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#444444' });
const front: DebugDrawOptions = { color: '#ff6b6b', duration: 999 };
const hidden: DebugDrawOptions = { color: '#4cc9f0', duration: 999, depthTest: true };
render.debug.line([-2, 0.2, 0], [2, 0.2, 0], front); // 永遠畫在最上面
render.debug.line([-2, -0.2, 0], [2, -0.2, 0], hidden); // 被方塊擋住
engine.start();
```

## DefaultLightsOptions
`spawn.defaultLights` 的設定：亮度、太陽位置、陰影。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 3, 6], target: [0, 0, 0] });
spawn.mesh(world, { geometry: { plane: 10 }, material: '#888888', rotation: [-Math.PI / 2, 0, 0] });
spawn.mesh(world, { geometry: { box: 1 }, material: '#ffa94f', position: [0, 0.5, 0] });
const options: DefaultLightsOptions = { intensity: 1, sun: [-4, 5, 2] };
const { ambient, sun } = spawn.defaultLights(world, options);
const gui = new GUI();
gui.add(world.require(sun, Light), 'intensity', 0, 6, 0.1).name('太陽亮度');
gui.add(world.require(ambient, Light), 'intensity', 0, 3, 0.1).name('環境光亮度');
engine.start();
```

## LightData
Light 元件的資料。聚光燈：角度、邊緣柔和度。用 lil-gui 調整。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 4, 6], target: [0, 0, 0] });
spawn.mesh(world, { geometry: { plane: 10 }, material: '#aaaaaa', rotation: [-Math.PI / 2, 0, 0] });
spawn.light(world, { kind: 'ambient', intensity: 0.1 });
const spot = spawn.light(world, { kind: 'spot', intensity: 40, position: [0, 4, 0], target: [0, 0, 0] });
const data: LightData = world.require(spot, Light);
const deg = { angle: 30 };
const gui = new GUI();
gui.add(deg, 'angle', 5, 80, 1).name('角度（度）').onChange((v: number) => (data.angle = MathUtils.degToRad(v)));
gui.add(data, 'penumbra', 0, 1, 0.05).name('邊緣柔和');
gui.addColor(data, 'color').name('顏色');
data.angle = MathUtils.degToRad(deg.angle);
engine.start();
```

## MeshRendererData
MeshRenderer 的資料：幾何、材質、陰影、是否顯示、繪製順序。

```ts
spawn.camera(world, { position: [0, 1, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const e = spawn.mesh(world, { geometry: { sphere: 0.7 }, material: '#ff6b6b' });
engine.timers.every(0.5, () => {
  const m: MeshRendererData = world.require(e, MeshRenderer);
  m.visible = !m.visible; // 一閃一閃
});
engine.start();
```

## OrbitControlData
OrbitControl 的資料：可以做什麼、速度、距離與角度範圍、慣性、自動旋轉。

```ts
const data: OrbitControlData = OrbitControl.create();
console.log('預設距離範圍：', data.minDistance, '~', data.maxDistance);
console.log('上下角度範圍（度）：', MathUtils.radToDeg(data.minPolarAngle).toFixed(0), '~', MathUtils.radToDeg(data.maxPolarAngle).toFixed(0));
```

## RaycastHit
`render.raycast`／`render.pick` 的結果：點到的實體、位置、距離、法線。這裡從畫面中央往前打。

```ts
spawn.camera(world, { position: [0, 1, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#9acd32', name: '前面的方塊' });
spawn.mesh(world, { geometry: { box: 2 }, material: '#4cc9f0', position: [0, 0, -3], name: '後面的方塊' });
engine.start();
engine.timers.after(0.2, () => {
  const hits: RaycastHit[] = render.raycast(0, 0);
  for (const h of hits) console.log(world.get(h.entity, Name)?.value, '距離', h.distance.toFixed(2), '法線', h.normal?.toArray());
});
```

## RenderOptions
`new RenderPlugin(options)` 的設定：畫布、背景、陰影、動態解析度、繞轉控制。`RenderPlugin.defaults` 可以改所有繪製外掛的預設值。

```ts
const options: RenderOptions = { background: '#203040', shadows: true, antialias: true, orbitControls: { autoRotate: 0.5 } };
console.log('設定：', options);
console.log('目前的背景：', render.renderer.getClearColor(new Color()).getHexString());
```

## EngineRenderer
`render.renderer` 的型別：three.js 的 WebGPURenderer（瀏覽器不支援 WebGPU 時它自動改用 WebGL2，`render.gpuApi` 是實際用的圖形介面）。尺寸、像素比、背景顏色、陰影…可以直接用。

```ts
const r: EngineRenderer = render.renderer;
await render.ready; // WebGPURenderer 要先非同步初始化
console.log('像素比', r.getPixelRatio(), '，陰影', r.shadowMap.enabled, '，圖形介面', render.gpuApi);
```

## OverlayCompositor
接管繪製的外掛（例如後製）用來把介面疊到最後輸出的顏色上：`render.setDrawHandler(handler, { compositesOverlays: true })` 時，handler 的第三個參數就是它。在最後的顏色上呼叫 `composite`、直接畫到畫布，回傳 `'composited'`，可以省下一次全螢幕的合成（後製外掛就是這樣做的）。

```ts
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: '#9acd32' });
postfx.settings.bloom.enabled = true;
engine.timers.after(0.5, () => console.log('後製的步驟：', postfx.passNames.join(' → '), '（overlay：介面在最後一起輸出）'));
const check: OverlayCompositor | null = null;
console.log('自己接管繪製時，handler 的第三個參數是 OverlayCompositor：', check === null ? '（這裡沒有接管）' : check);
engine.start();
```

## RenderLayerData
RenderLayer 的資料：物件在哪些圖層。

```ts
const data: RenderLayerData = { layers: ['default', 'minimap'] };
const e = spawn.mesh(world, { geometry: { box: 1 }, material: '#fff' });
world.add(e, RenderLayer, data);
console.log('在圖層：', world.require(e, RenderLayer).layers, '，mask：', render.layers.mask(data.layers));
```

## SceneObjectData
SceneObject 的資料：要放進場景的 three.js 物件。可以隨時換。

```ts
spawn.camera(world, { position: [0, 1, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const objects = [create.mesh({ box: 1 }, { normal: {} }), create.mesh({ sphere: 0.6 }, { normal: {} })];
const e = world.spawn(Transform, SceneObject.with({ object: objects[0] }));
engine.timers.every(1, () => {
  const data: SceneObjectData = world.require(e, SceneObject);
  data.object = data.object === objects[0] ? objects[1] : objects[0];
});
engine.start();
```

## SpawnCameraOptions
`spawn.camera` 的設定：攝影機的欄位，加上位置與看向的目標。

```ts
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#ffa94f' });
const options: SpawnCameraOptions = { position: [4, 4, 4], target: [0, 0, 0], fov: 35, name: '主攝影機' };
const cam = spawn.camera(world, options);
console.log(world.require(cam, Name).value, '視角', world.require(cam, Camera).fov);
engine.start();
```

## SpawnCommon
所有 spawn 共用的設定：父節點、名稱。

```ts
const common: SpawnCommon = { name: '車子' };
const car = spawn.entity(world, { ...common, position: [0, 0, 0] });
const wheel = spawn.entity(world, { name: '輪子', parent: car, position: [1, 0, 0] });
console.log(world.require(wheel, Name).value, '的父物件是', world.require(hierarchy.parentOf(wheel)!, Name).value);
```

## SpawnEntityOptions
`spawn.entity` 的設定：位置、旋轉（弧度）、縮放、父節點、名稱。

```ts
const options: SpawnEntityOptions = { position: [1, 2, 3], rotation: [0, Math.PI, 0], scale: [2, 2, 2], name: '空物件' };
const e = spawn.entity(world, options);
const t = world.require(e, Transform);
console.log('位置', t.position.toArray(), '縮放', t.scale.toArray());
```

## SpawnGridOptions
`spawn.grid` 的設定：大小、格數、顏色、位置。

```ts
spawn.camera(world, { position: [0, 8, 8], target: [0, 0, 0] });
const options: SpawnGridOptions = { size: 12, divisions: 24, color: '#335577', centerColor: '#ff6b6b' };
spawn.grid(world, options);
spawn.grid(world, { size: 4, divisions: 4, color: '#9acd32', position: [0, 1, 0] });
engine.start();
```

## SpawnLightOptions
`spawn.light` 的設定：燈光的欄位，加上位置與照向的目標。

```ts
spawn.camera(world, { position: [0, 3, 6], target: [0, 0, 0] });
spawn.mesh(world, { geometry: { plane: 8 }, material: '#999999', rotation: [-Math.PI / 2, 0, 0] });
spawn.mesh(world, { geometry: { sphere: 0.5 }, material: '#ffffff', position: [0, 0.5, 0] });
const options: SpawnLightOptions = { kind: 'directional', color: '#ffddaa', intensity: 2.5, position: [-3, 4, 2], target: [0, 0, 0] };
spawn.light(world, options);
spawn.light(world, { kind: 'hemisphere', color: '#88aaff', groundColor: '#443322', intensity: 0.6 });
engine.start();
```

## SpawnMeshOptions
`spawn.mesh` 的設定：幾何、材質，加上位置、旋轉、縮放、陰影。

```ts
spawn.camera(world, { position: [0, 3, 6], target: [0, 0, 0] });
spawn.defaultLights(world, { shadows: true });
const floor: SpawnMeshOptions = { geometry: { plane: 10 }, material: '#777777', rotation: [-Math.PI / 2, 0, 0], receiveShadow: true };
spawn.mesh(world, floor);
spawn.mesh(world, { geometry: { box: 1 }, material: '#ffa94f', position: [0, 1, 0], scale: 1.2, castShadow: true });
engine.start();
```

## TextureOptions
貼圖的設定：色彩空間、重複次數、超出範圍的方式。材質描述的 `repeat`、`wrap` 會變成這些設定。

```ts
const options: TextureOptions = { colorSpace: 'srgb', repeat: [4, 4], wrap: 'repeat' };
console.log('貼圖設定：', options);
const m = create.material({ standard: { color: '#ffffff', repeat: 4, wrap: 'mirror' } });
console.log('材質描述也可以直接寫 repeat、wrap：', m.type);
```

## BlendingName
重疊方式的名稱：`additive` 讓重疊的地方變亮（發光、火焰）。

```ts
spawn.camera(world, { position: [0, 0, 4], target: [0, 0, 0] });
const modes: BlendingName[] = ['normal', 'additive'];
modes.forEach((blending, i) => {
  for (let j = 0; j < 3; j++)
    spawn.mesh(world, {
      geometry: { circle: 0.5 },
      material: { basic: { color: ['#ff3030', '#30ff30', '#3030ff'][j], transparent: true, opacity: 0.8, blending } },
      position: [(i ? 1.2 : -1.2) + (j - 1) * 0.35, (j % 2) * 0.3, j * 0.01],
    });
});
console.log('左邊 normal，右邊 additive（重疊處變亮）');
engine.start();
```

## CameraKind
攝影機種類：`perspective` 有遠近感，`orthographic` 沒有（2D、等角視角）。

```ts
spawn.defaultLights(world);
for (let i = 0; i < 5; i++) spawn.mesh(world, { geometry: { box: 0.8 }, material: '#9acd32', position: [i - 2, 0, -i * 1.5] });
const cam = spawn.camera(world, { position: [4, 4, 4], target: [0, 0, -3], size: 4 });
engine.timers.every(1.5, () => {
  const c = world.require(cam, Camera);
  const next: CameraKind = c.kind === 'perspective' ? 'orthographic' : 'perspective';
  c.kind = next;
  console.log('切換成', next);
});
engine.start();
```

## DrawHandler
接管繪製的函式（後製外掛就是這樣做的）。這裡示範把畫面畫成線框；手冊的後製外掛已經接管，所以先讓它放開。

```ts
spawn.camera(world, { position: [0, 1, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: '#ffa94f' });
const wire = create.material({ basic: { color: '#4cc9f0', wireframe: true } });
const handler: DrawHandler = (scene, camera) => {
  scene.overrideMaterial = wire;
  render.renderer.render(scene, camera);
  scene.overrideMaterial = null;
};
engine.removePlugin('postfx');
render.setDrawHandler(handler);
engine.start();
```

## GeometryDesc
幾何描述：box、sphere、plane、circle、cylinder、cone、capsule、torus、torusKnot 與幾種多面體；`rotation`、`offset` 先轉動、移動幾何。

```ts
spawn.camera(world, { position: [0, 4, 8], target: [0, 0, 0] });
spawn.defaultLights(world);
const shapes: GeometryDesc[] = [
  { box: [1, 0.5, 0.5] }, { sphere: 0.5 }, { cylinder: [0.3, 1] }, { cone: [0.5, 1] }, { capsule: [0.3, 0.5] },
  { torus: [0.4, 0.15] }, { torusKnot: [0.35, 0.12] }, { dodecahedron: 0.5 }, { octahedron: 0.5 }, { tetrahedron: 0.5 },
];
shapes.forEach((geometry, i) => spawn.mesh(world, { geometry, material: '#9acd32', position: [(i % 5) * 1.6 - 3.2, 0, Math.floor(i / 5) * 2 - 1] }));
spawn.mesh(world, { geometry: { box: 1, offset: [0, 0.5, 0] }, material: '#ff6b6b', position: [0, 0, 2.5] }); // 以底部為中心
// vertices：自己給頂點（這裡是一個金字塔：四個三角形）
const top = [0, 0.8, 0];
const base = [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5]];
const vertices = base.flatMap((p, i) => [...p, ...base[(i + 1) % 4], ...top]);
spawn.mesh(world, { geometry: { vertices }, material: '#ffd166', position: [2, 0, 2.5] });
engine.start();
```

## LightKind
燈光種類：環境光、半球光、平行光、點光源、聚光燈。點畫面切換。

```ts
spawn.camera(world, { position: [0, 3, 5], target: [0, 0, 0] });
spawn.mesh(world, { geometry: { plane: 8 }, material: '#999999', rotation: [-Math.PI / 2, 0, 0] });
spawn.mesh(world, { geometry: { sphere: 0.6 }, material: '#ffffff', position: [0, 0.6, 0] });
const kinds: LightKind[] = ['ambient', 'hemisphere', 'directional', 'point', 'spot'];
const light = spawn.light(world, { kind: 'directional', intensity: 3, position: [2, 3, 2], target: [0, 0, 0] });
let i = 2;
addEventListener('pointerdown', () => {
  const data = world.require(light, Light);
  data.kind = kinds[++i % kinds.length];
  data.intensity = data.kind === 'point' || data.kind === 'spot' ? 25 : 2;
  console.log('燈光：', data.kind);
});
engine.start();
```

## MaterialDesc
材質描述：一個顏色（standard 材質），或 `{ standard / physical / basic / lambert / phong / toon / normal: 參數 }`。內容一樣的會共用。

```ts
spawn.camera(world, { position: [0, 1.5, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
const materials: MaterialDesc[] = [
  '#ff6b6b',
  { standard: { color: '#c0c0c0', metalness: 1, roughness: 0.2 } },
  { basic: { color: '#ffd166' } },
  { lambert: { color: '#4cc9f0' } },
  { phong: { color: '#9acd32', shininess: 100 } },
  { toon: { color: '#ffa94f' } },
  { normal: {} },
];
materials.forEach((material, i) => spawn.mesh(world, { geometry: { sphere: 0.4 }, material, position: [i - 3, 0, 0] }));
engine.start();
```

## MaterialFactory
`registerMaterialType` 的函式：描述裡那個鍵的值 → 材質。第二個參數是整個描述。

```ts
const factory: MaterialFactory = (value, desc) => {
  console.log('收到', value, '，整個描述：', desc);
  return create.material({ normal: { wireframe: value === 'wire' } });
};
registerMaterialType('debug', factory);
const m = create.material({ debug: 'wire' } as unknown as MaterialDesc);
console.log('建立的材質：', m.type);
```

## MaterialOf
描述對應的材質類別：`create.material({ physical: … })` 的型別就是 MeshPhysicalMaterial，可以直接用它的欄位。

```ts
const glass: MaterialOf<{ physical: { transmission: number } }> = create.material({ physical: { transmission: 1 } });
glass.thickness = 0.5; // MeshPhysicalMaterial 才有的欄位
console.log(glass.type, glass.transmission, glass.thickness);
```

## MaterialParams
材質描述的參數：和 three.js 一樣，另外 `side`、`blending` 可以寫名稱，貼圖可以寫網址，`repeat`、`wrap` 設定貼圖。

```ts
const params: MaterialParams<THREE.MeshStandardMaterialParameters> = { color: '#ffffff', side: 'double', blending: 'normal', repeat: [2, 1], wrap: 'mirror' };
const m = create.material({ standard: params });
console.log('side：', m.side, '（0 正面、1 背面、2 雙面）');
```

## Vec3Like
三維向量的寫法：`[x, y, z]`、`{ x, y, z }` 或 Vector3，大部分參數都接受。

```ts
const list: Vec3Like[] = [[1, 0, 0], { x: 0, y: 1, z: 0 }, new Vector3(0, 0, 1)];
for (const v of list) console.log(math.toVector3(v).toArray());
```

## WrapName
貼圖超出 0～1 時的方式：`repeat` 重複、`clamp` 延伸邊緣、`mirror` 鏡像重複。

```ts
const names: WrapName[] = ['repeat', 'clamp', 'mirror'];
for (const wrap of names) {
  const m = create.material({ standard: { color: '#fff', wrap } });
  console.log(wrap, '→ 材質', m.type);
}
```

## MeshOptions
`create.mesh` 的設定：名稱、位置、旋轉（弧度）、縮放，加上陰影。

```ts
spawn.camera(world, { position: [0, 3, 5], target: [0, 0.5, 0] });
spawn.defaultLights(world, { shadows: true });
spawn.mesh(world, { geometry: { plane: 6 }, material: '#777777', rotation: [-Math.PI / 2, 0, 0], receiveShadow: true });
const options: MeshOptions = { name: 'crate', position: [0, 0.5, 0], rotation: [0, Math.PI / 4, 0], scale: 1.2, castShadow: true };
const crate = create.mesh({ box: 0.8 }, '#c58b4c', options);
world.spawn(Transform, SceneObject.with({ object: crate }));
console.log(crate.name, '位置', crate.position.toArray(), '投射陰影', crate.castShadow);
engine.start();
```

## ObjectOptions
物件的名稱、位置、旋轉、縮放（`create.group` 的第一個參數、`create.mesh`、`create.points` 都接受）。名稱讓模型動畫找得到它。

```ts
const options: ObjectOptions = { name: 'wheel', position: [1, 0.3, 0], rotation: [Math.PI / 2, 0, 0], scale: [1, 0.5, 1] };
const wheel = create.group(options);
console.log(wheel.name, wheel.position.toArray(), wheel.rotation.x.toFixed(2), wheel.scale.toArray());
```

## PointsOptions
`create.points` 的設定：顏色（或每個點各自的顏色）、大小、越遠越小、不透明度、疊加發亮。用 lil-gui 調整。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 0, 5], target: [0, 0, 0] });
const n = 2000;
const positions = Array.from({ length: n }, (_, i) => {
  const a = i * 0.1;
  const r = 0.2 + i / n * 2.5;
  return [Math.cos(a) * r, (Math.random() - 0.5) * 0.2, Math.sin(a) * r] as [number, number, number];
});
const colors = positions.flatMap((_, i) => [1, 0.5 + (i / n) * 0.5, 1 - i / n]);
const options: PointsOptions = { colors, size: 0.04, blending: 'additive', opacity: 0.9 };
const galaxy = create.points(positions, options);
const e = world.spawn(Transform.at(0, 0, 0), SceneObject.with({ object: galaxy }));
math.setRotation(world.require(e, Transform), [0.6, 0, 0]);
engine.on('update', (t) => math.rotate(world.require(e, Transform), [0, t.delta * 0.3, 0]));
const mat = galaxy.material as unknown as { size: number; opacity: number; transparent: boolean };
const gui = new GUI();
gui.add(mat, 'size', 0.005, 0.15, 0.005).name('點的大小');
gui.add(mat, 'opacity', 0, 1, 0.05).name('不透明度').onChange(() => (mat.transparent = true));
engine.start();
```

## TextureImage
`create.texture` 除了網址，也可以給畫布、圖片、ImageBitmap、影片。畫布重畫後設定 `needsUpdate = true`。這裡做一個每秒更新的計分板。

```ts
spawn.camera(world, { position: [0, 0, 2.5], target: [0, 0, 0] });
const canvas: TextureImage = Object.assign(document.createElement('canvas'), { width: 256, height: 128 });
const g = canvas.getContext('2d')!;
const tex = create.texture(canvas);
spawn.mesh(world, { geometry: { plane: [2, 1] }, material: { basic: { map: tex } } });
engine.timers.every(1, () => {
  g.fillStyle = '#20304a';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#ffd166';
  g.font = 'bold 56px sans-serif';
  g.fillText(`${Math.floor(engine.time.elapsed)} 秒`, 30, 85);
  tex.needsUpdate = true;
}, { immediate: true });
engine.start();
```

## Mesh
網格的型別（three.js）：`create.mesh` 建立的、`render.getObject(實體)` 取得的都是它。

```ts
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
const e = spawn.mesh(world, { geometry: { box: 1 }, material: '#4cc9f0' });
engine.start();
engine.timers.after(0.1, () => {
  const mesh = render.getObject(e) as Mesh;
  console.log('頂點數：', mesh.geometry.getAttribute('position').count, '，材質：', (mesh.material as Material).type);
});
```

## Group
群組的型別（three.js）：`create.group` 建立的就是它，可以 `add` 更多子物件。

```ts
const g: Group = create.group({ name: 'pack' });
for (let i = 0; i < 3; i++) g.add(create.mesh({ sphere: 0.2 }, '#ff6b6b', { position: [i * 0.5, 0, 0] }));
console.log(g.name, '有', g.children.length, '個子物件');
```

## Points
點雲的型別（three.js）：`create.points` 建立的就是它。可以直接改頂點位置做動畫。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
const n = 400;
const p: Points = create.points(Array.from({ length: n }, (_, i) => [(i % 20) / 4 - 2.4, 0, Math.floor(i / 20) / 4 - 2.4] as [number, number, number]), { color: '#4cc9f0', size: 0.06 });
world.spawn(Transform, SceneObject.with({ object: p }));
const pos = p.geometry.getAttribute('position');
engine.on('update', (t) => {
  for (let i = 0; i < n; i++) pos.setY(i, Math.sin(pos.getX(i) * 2 + t.elapsed * 2) * 0.3 + Math.cos(pos.getZ(i) * 2 + t.elapsed) * 0.3);
  pos.needsUpdate = true;
});
engine.start();
```
