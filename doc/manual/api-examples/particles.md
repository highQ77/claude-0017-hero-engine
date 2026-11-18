# @engine/particles 的範例

## ParticleController
粒子模擬的控制器（`particlePlugin.controller`）：全部的粒子數、清除某個發射器的粒子。點畫面清除。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 1, 0] });
const fire = world.spawn(Transform, ParticleEmitter.with(ParticlePresets.fire()));
engine.timers.every(1, () => console.log('存活的粒子：', particlePlugin.controller.totalParticles));
addEventListener('pointerdown', () => {
  particlePlugin.controller.clear(fire);
  console.log('清除！');
});
engine.start();
```

## ParticlePlugin
粒子外掛（手冊的 `particlePlugin` 已經裝好）。

```ts
console.log('外掛：', particlePlugin.name, '，依賴：', particlePlugin.dependencies.join('、'));
console.log('控制器：', particlePlugin.controller === world.requireResource(ParticlesKey));
```

## create
自訂粒子繪製時用：粒子幾何、粒子材質、預設的圓形貼圖。

```ts
const tex = create.particleTexture();
console.log('圓形貼圖：', tex.image.width, 'x', tex.image.height);
const { geometry, attributes } = create.particleGeometry(100);
console.log('粒子幾何的屬性：', Object.keys(attributes), '，上限', geometry.instanceCount);
console.log('材質：', create.particleMaterial().type);
```

## PARTICLE_PRIORITY
粒子模擬在 update 階段的順序（補間是 100，粒子在它之後）。

```ts
console.log('補間：', TWEEN_PRIORITY, '→ 粒子：', PARTICLE_PRIORITY);
```

## ParticleEmitter
粒子發射器：發射速度、壽命、方向、顏色、大小……所有欄位都能在執行中修改。用 lil-gui 調整看看。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 2, 6], target: [0, 1.5, 0] });
const e = world.spawn(Transform, ParticleEmitter.with({ rate: 80, lifetime: [1, 2], speed: [1, 3], spread: 0.4, size: [0.1, 0.2], sizeEnd: 0.2, color: '#66ccff', colorEnd: '#ff66cc', acceleration: { x: 0, y: -1, z: 0 } }));
const em = world.require(e, ParticleEmitter);
const gui = new GUI();
gui.add(em, 'rate', 0, 400, 1).name('每秒數量');
gui.add(em, 'spread', 0, Math.PI, 0.01).name('擴散角');
gui.add(em, 'sizeEnd', 0, 3, 0.05).name('結束大小倍率');
gui.add(em, 'stretch', 0, 1, 0.01).name('拉長');
gui.addColor(em, 'color').name('開始顏色');
gui.addColor(em, 'colorEnd').name('結束顏色');
gui.add(em, 'blending', ['additive', 'normal']).name('重疊方式');
engine.start();
```

## particleEmitterCodec
ParticleEmitter 在場景檔裡的寫法。

```ts
const data = { ...ParticleEmitter.create(), ...ParticlePresets.smoke() };
console.log(particleEmitterCodec.write(data));
```

## ParticlePresets
常用特效：火、煙、火花、爆炸。點畫面在隨機位置爆炸（一次性，播完自動刪除）。

```ts
spawn.camera(world, { position: [0, 3, 8], target: [0, 1, 0] });
world.spawn(Transform.at(-2.5, 0, 0), ParticleEmitter.with(ParticlePresets.fire()));
world.spawn(Transform.at(0, 0, 0), ParticleEmitter.with(ParticlePresets.smoke()));
world.spawn(Transform.at(2.5, 0.5, 0), ParticleEmitter.with(ParticlePresets.sparks()));
addEventListener('pointerdown', () => {
  world.spawn(Transform.at(Math.random() * 6 - 3, 2, 0), ParticleEmitter.with(ParticlePresets.explosion()));
  console.log('碰！');
});
engine.start();
```

## ParticlesKey
系統裡用 `world.requireResource(ParticlesKey)` 取得粒子控制器。

```ts
console.log('和外掛的控制器同一個：', world.requireResource(ParticlesKey) === particlePlugin.controller);
```

## play
`play.burst`：讓發射器立刻噴出一批粒子（受傷、撿到東西）。點畫面噴發。

```ts
spawn.camera(world, { position: [0, 2, 5], target: [0, 0.5, 0] });
const e = world.spawn(Transform, ParticleEmitter.with({ rate: 0, speed: [2, 4], spread: Math.PI, lifetime: [0.5, 1], color: '#ffd166', colorEnd: '#ff6b6b', acceleration: { x: 0, y: -6, z: 0 } }));
addEventListener('pointerdown', () => play.burst(world.require(e, ParticleEmitter), 60));
play.burst(world.require(e, ParticleEmitter), 60);
console.log('點畫面噴發 60 個粒子');
engine.start();
```

## ParticleEmitterData
發射器的資料。`space: 'local'` 讓粒子跟著發射器移動；`'world'` 留在原地（拖尾）。這裡兩個繞圈的發射器比較兩者。

```ts
spawn.camera(world, { position: [0, 4, 7], target: [0, 0, 0] });
const base: Partial<ParticleEmitterData> = { rate: 60, lifetime: 1.2, speed: 0.2, size: 0.15, color: '#4cc9f0', colorEnd: '#ffffff', opacityEnd: 0 };
const a = world.spawn(Transform, ParticleEmitter.with({ ...base, space: 'world' }));
const b = world.spawn(Transform, ParticleEmitter.with({ ...base, space: 'local', color: '#ff6b6b' }));
engine.on('update', (t) => {
  world.require(a, Transform).position.set(Math.cos(t.elapsed * 2) * 2 - 0.5, 0.5, Math.sin(t.elapsed * 2) * 2);
  world.require(b, Transform).position.set(Math.cos(t.elapsed * 2 + Math.PI) * 2 + 0.5, -0.5, Math.sin(t.elapsed * 2 + Math.PI) * 2);
  if (t.frame % 60 === 0) console.log('藍（world）存活', world.require(a, ParticleEmitter).aliveCount, '，紅（local）', world.require(b, ParticleEmitter).aliveCount);
});
engine.start();
```

## EmitterShape
發射位置的形狀：點、球、方塊、圓。點畫面切換。

```ts
spawn.camera(world, { position: [0, 3, 5], target: [0, 0, 0] });
const shapes: EmitterShape[] = ['point', 'sphere', 'box', 'circle'];
const e = world.spawn(Transform, ParticleEmitter.with({ rate: 200, speed: 0.1, lifetime: 1, radius: 1, halfExtents: { x: 1, y: 0.2, z: 1 }, size: 0.06, color: '#9acd32' }));
let i = 0;
addEventListener('pointerdown', () => {
  world.require(e, ParticleEmitter).shape = shapes[++i % shapes.length];
  console.log('形狀：', shapes[i % shapes.length]);
});
engine.start();
```

## Range
固定值，或 `[最小, 最大]` 之間隨機。

```ts
spawn.camera(world, { position: [0, 2, 6], target: [0, 1, 0] });
const fixed: Range = 2;
const random: Range = [0.5, 4];
world.spawn(Transform.at(-1.5, 0, 0), ParticleEmitter.with({ speed: fixed, spread: 0.2, color: '#4cc9f0' }));
world.spawn(Transform.at(1.5, 0, 0), ParticleEmitter.with({ speed: random, spread: 0.2, color: '#ff6b6b' }));
console.log('左：速度固定', fixed, '；右：速度在', random, '之間');
engine.start();
```
