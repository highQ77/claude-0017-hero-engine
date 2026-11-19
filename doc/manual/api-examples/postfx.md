# @engine/postfx 的範例

## PostProcessingPlugin
後製外掛（`postfx`）：光暈、環境光遮蔽、景深、底片顆粒、暗角、調色、反鋸齒。直接改 `postfx.settings`，下一幀生效。用 lil-gui 調整。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 2, 6], target: [0, 0.5, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { plane: 10 }, material: '#555555', rotation: [-Math.PI / 2, 0, 0] });
for (let i = 0; i < 5; i++)
  spawn.mesh(world, { geometry: { sphere: 0.4 }, material: { standard: { color: '#222', emissive: `hsl(${i * 60}, 90%, 55%)`, emissiveIntensity: 3 } }, position: [i * 1.2 - 2.4, 0.4, 0] });
const s = postfx.settings;
s.toneMapping = 'aces';
s.bloom.enabled = true;
const gui = new GUI();
gui.add(s, 'toneMapping', ['none', 'linear', 'reinhard', 'cineon', 'aces', 'agx', 'neutral']).name('色調映射');
gui.add(s, 'exposure', 0.2, 3, 0.05).name('曝光');
const b = gui.addFolder('光暈');
b.add(s.bloom, 'enabled').name('開啟');
b.add(s.bloom, 'strength', 0, 3, 0.05).name('強度');
b.add(s.bloom, 'threshold', 0, 1, 0.01).name('門檻');
const v = gui.addFolder('暗角');
v.add(s.vignette, 'enabled').name('開啟');
v.add(s.vignette, 'darkness', 0, 2, 0.05).name('暗度');
const f = gui.addFolder('底片顆粒');
f.add(s.film, 'enabled').name('開啟');
f.add(s.film, 'grayscale').name('黑白');
engine.timers.after(0.5, () => console.log('效果清單：', postfx.passNames.join(' → ')));
engine.start();
```

## ColorGradeEffect
內建的調色加暗角（合併成一次全螢幕繪製），是 ShaderLibrary 的全螢幕效果（名稱 `postfx.colorGrade`）：開啟 `settings.color` 或 `settings.vignette` 時由後製註冊、建立。可以讀它的定義，也可以用 `shaders.update` 在執行中修改著色器。

```ts
spawn.camera(world, { position: [0, 1.5, 4], target: [0, 0.5, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.7, 0.25] }, material: '#4cc9f0', position: [0, 0.8, 0] });
postfx.settings.color.enabled = true;
postfx.settings.color.saturation = 1.4;
postfx.settings.vignette.enabled = true;
console.log('效果名稱：', ColorGradeEffect.name, '，uniform：', Object.keys(ColorGradeEffect.uniforms ?? {}).join('、'));
// 管線建立後（下一幀）就註冊好了：把暗角改成藍色調
engine.timers.after(0.5, () => {
  console.log('已註冊：', shaders.has(ColorGradeEffect.name));
  shaders.update(ColorGradeEffect.name, {
    fragment: `${ColorGradeEffect.fragment}\n    color.rgb = mix(color.rgb, vec3(0.1, 0.2, 0.6), dot(uv - 0.5, uv - 0.5));`,
  });
});
engine.start();
```

## create
`create.postFxSettings`：預設的後製設定（全部效果關閉）。可以用來「恢復預設」。

```ts
const defaults = create.postFxSettings();
console.log('預設的光暈：', defaults.bloom, '，反鋸齒：', defaults.antialias);
postfx.settings.bloom.strength = 3;
Object.assign(postfx.settings.bloom, defaults.bloom); // 恢復預設
console.log('恢復後：', postfx.settings.bloom.strength);
```

## PostFxKey
系統裡用 `world.requireResource(PostFxKey)` 取得後製外掛。

```ts
const fx = world.requireResource(PostFxKey);
console.log('和 postfx 同一個：', fx === postfx, '，色調映射：', fx.settings.toneMapping);
```

## PostFxSettings
後製設定的所有欄位。這裡用景深對焦在移動的球上（`dof.focusOn`）、加上調色。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 1.5, 6], target: [0, 0.5, 0] });
spawn.defaultLights(world);
for (let i = 0; i < 6; i++) spawn.mesh(world, { geometry: { box: 0.6 }, material: '#9acd32', position: [i - 2.5, 0.3, -i * 1.5 + 2] });
const ball = spawn.mesh(world, { geometry: { sphere: 0.3 }, material: '#ff6b6b', position: [0, 0.5, 0] });
const s: PostFxSettings = postfx.settings;
s.dof.enabled = true;
s.dof.focusOn = ball;
s.dof.aperture = 0.02;
s.color.enabled = true;
engine.on('update', (t) => (world.require(ball, Transform).position.z = Math.sin(t.elapsed * 0.7) * 4 - 1));
const gui = new GUI();
gui.add(s.dof, 'enabled').name('景深');
gui.add(s.dof, 'aperture', 0, 0.05, 0.001).name('光圈');
gui.add(s.color, 'saturation', 0, 2, 0.05).name('飽和度');
gui.add(s.color, 'contrast', 0.5, 1.5, 0.05).name('對比');
gui.addColor(s.color, 'tint').name('色調');
engine.start();
```

## AntialiasMode
反鋸齒方式：`auto` 依螢幕自動選、`msaa`、`fxaa`、`smaa`、`none`。

```ts
const modes: AntialiasMode[] = ['auto', 'fxaa', 'smaa', 'none'];
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.15] }, material: '#ffffff' });
let i = 0;
addEventListener('pointerdown', () => {
  postfx.settings.antialias = modes[++i % modes.length];
  setTimeout(() => console.log('設定', postfx.settings.antialias, '→ 實際', postfx.resolvedAntialias), 100);
});
console.log('點畫面切換反鋸齒；目前實際使用：', postfx.resolvedAntialias);
engine.start();
```

## PassStage
自訂效果放在哪個階段：`scene` 在色調映射前（線性顏色），`display` 在之後（最終顏色）。這裡在 display 加一個掃描線效果。

```ts
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: '#ffa94f' });
const scanlines = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); c.rgb *= 0.8 + 0.2 * sin(vUv.y * 600.0 + time * 5.0); gl_FragColor = c; }',
});
const stage: PassStage = 'display';
postfx.addPass(scanlines, stage);
engine.on('update', (t) => (scanlines.uniforms.time.value = t.elapsed));
engine.timers.after(0.3, () => console.log('效果清單：', postfx.passNames));
engine.start();
```

## ToneMappingName
色調映射：把很亮的顏色壓回螢幕能顯示的範圍。點畫面切換，看高亮的地方怎麼變。

```ts
spawn.camera(world, { position: [0, 1, 4], target: [0, 0, 0] });
spawn.light(world, { kind: 'point', intensity: 60, position: [1, 2, 2] });
spawn.mesh(world, { geometry: { sphere: 0.8 }, material: '#ffcc88' });
const names: ToneMappingName[] = ['none', 'linear', 'reinhard', 'cineon', 'aces', 'agx', 'neutral'];
let i = 0;
addEventListener('pointerdown', () => {
  postfx.settings.toneMapping = names[++i % names.length];
  console.log('色調映射：', postfx.settings.toneMapping);
});
console.log('點畫面切換');
engine.start();
```

## PostFxEffect
`postfx.settings.effects` 的一項：效果名稱（`shaders.defineEffect` 註冊的、內建的 `EffectPresets`），或 `{ graph: '節點圖檔' }`（著色器編輯器做的全螢幕效果，自動載入）。物件寫法可以加 `uniforms`（每幀寫入）、`stage`、`enabled`。載入完成後自動加進後製，點畫面切換。

```ts
spawn.camera(world, { position: [0, 1.5, 4], target: [0, 0.5, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.7, 0.25] }, material: '#ffb347', position: [0, 0.8, 0] });
const crt: PostFxEffect = { graph: 'shaders/crt.shader.json' };
const lists: PostFxEffect[][] = [[crt], ['pixelate'], [{ name: 'chromaticAberration', uniforms: { amount: 0.01 } }, crt], []];
let i = 0;
postfx.settings.effects = lists[0];
addEventListener('pointerdown', () => {
  postfx.settings.effects = lists[++i % lists.length];
  console.log('effects：', JSON.stringify(postfx.settings.effects));
});
engine.timers.after(1, () => console.log('效果清單：', postfx.passNames.join(' → ')));
engine.start();
```

