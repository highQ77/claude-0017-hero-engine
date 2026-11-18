# @engine/shaders 的範例

## ShaderLibrary
著色器庫（`shaders`）：`define` 註冊自訂材質，`createMaterial` 建立實例（uniform 各自獨立），`update` 執行中修改程式。用 lil-gui 調整 uniform。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 1, 3.5], target: [0, 0, 0] });
spawn.defaultLights(world);
shaders.define({
  name: 'stripes',
  base: 'unlit',
  uniforms: { colorA: new Color('#ff6b6b'), colorB: new Color('#4cc9f0'), count: 10, speed: 1 },
  fragment: `
    float s = step(0.5, fract(vUv.y * count + uTime * speed));
    color = vec4(mix(colorA, colorB, s), 1.0);
  `,
});
const mat = shaders.createMaterial('stripes');
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: mat });
const gui = new GUI();
gui.add(mat.uniforms.count, 'value', 1, 40, 1).name('條紋數');
gui.add(mat.uniforms.speed, 'value', -3, 3, 0.1).name('速度');
gui.addColor(mat.uniforms.colorA, 'value').name('顏色 A');
gui.add({ diag: () => shaders.update('stripes', { fragment: 'float s = step(0.5, fract((vUv.x + vUv.y) * count + uTime * speed)); color = vec4(mix(colorA, colorB, s), 1.0);' }) }, 'diag').name('改成斜線（update）');
console.log('使用中的實例：', shaders.liveCount('stripes'));
engine.start();
```

## ShaderPlugin
著色器外掛（`shaderPlugin`）：提供著色器庫，並每幀更新 `uTime`、`uDeltaTime`、`uResolution`。

```ts
console.log('外掛：', shaderPlugin.name, '，著色器庫：', shaderPlugin.library === shaders);
engine.start();
engine.timers.after(1, () => console.log('uTime =', shaders.builtins.uTime.value.toFixed(2), '，uResolution =', shaders.builtins.uResolution.value.toArray()));
```

## compileShaderGraph
把節點圖編譯成著色器程式片段（3D 場景編輯器、著色器編輯器內部用）。這裡用程式組一張「UV 漸層」的圖。

```ts
const graph: ShaderGraph = {
  nodes: [
    { id: 1, type: 'uv', x: 0, y: 0, values: {}, params: {} },
    { id: 2, type: 'combine', x: 200, y: 0, values: { x: 0, y: 0, z: 0.6, w: 1 }, params: {} },
    { id: 3, type: 'split', x: 100, y: 0, values: {}, params: {} },
    { id: 4, type: 'output', x: 400, y: 0, values: { alpha: 1 }, params: {} },
  ],
  links: [
    { from: 1, fromPort: 'uv', to: 3, toPort: 'v' },
    { from: 3, fromPort: 'x', to: 2, toPort: 'x' },
    { from: 3, fromPort: 'y', to: 2, toPort: 'y' },
    { from: 2, fromPort: 'xyz', to: 4, toPort: 'color' },
  ],
  nextId: 5,
};
const compiled = compileShaderGraph(graph);
console.log('片段著色器：', compiled.fragment.trim());
console.log('半透明：', compiled.transparent, '，面：', compiled.side);
```

## defineShaderNode
新增一種節點（著色器編輯器的節點庫也會出現）。這裡做一個「棋盤格」節點，再用它組一張圖。

```ts
defineShaderNode({
  type: 'checker',
  title: '棋盤格',
  category: 'pattern',
  inputs: [{ name: 'scale', type: 'float', default: 8 }],
  outputs: [{ name: 'out', type: 'float' }],
  glsl: (i) => ({ out: `mod(floor(vUv.x * ${i.scale}) + floor(vUv.y * ${i.scale}), 2.0)` }),
});
const file: ShaderGraphFile = {
  format: 'hero-shader-graph',
  version: 1,
  graph: {
    nodes: [
      { id: 1, type: 'checker', x: 0, y: 0, values: { scale: 6 }, params: {} },
      { id: 2, type: 'output', x: 200, y: 0, values: { alpha: 1 }, params: {} },
    ],
    links: [{ from: 1, fromPort: 'out', to: 2, toPort: 'color' }],
    nextId: 3,
  },
};
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.mesh(world, { geometry: { box: 1.2 }, material: shaders.createFromDefinition(shaderGraphDefinition(file, 'checkerGraph')) });
engine.start();
```

## loadShaderGraph
下載節點圖檔（著色器編輯器存的 .shader.json）並轉成著色器定義。這裡把節點圖做成暫時的網址再載入。

```ts
const file: ShaderGraphFile = {
  format: SHADER_GRAPH_FORMAT,
  version: 1,
  graph: {
    nodes: [
      { id: 1, type: 'uv', x: 0, y: 0, values: {}, params: {} },
      { id: 2, type: 'noise', x: 150, y: 0, values: { scale: 10 }, params: {} },
      { id: 3, type: 'output', x: 300, y: 0, values: { alpha: 1 }, params: {} },
    ],
    links: [{ from: 1, fromPort: 'uv', to: 2, toPort: 'uv' }, { from: 2, fromPort: 'out', to: 3, toPort: 'color' }],
    nextId: 4,
  },
};
const url = URL.createObjectURL(new Blob([stringifyShaderGraphFile(file)]));
const def = await loadShaderGraph(url, 'noiseGraph');
shaders.define(def);
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.mesh(world, { geometry: { sphere: 0.9 }, material: shaders.createMaterial('noiseGraph') });
console.log('定義：', def.name, def.base);
engine.start();
```

## parseShaderGraphFile
讀取節點圖檔的內容（JSON 文字或物件），格式錯誤時丟出錯誤。

```ts
const text = JSON.stringify({ format: 'hero-shader-graph', version: 1, graph: { nodes: [{ id: 1, type: 'output', x: 0, y: 0, values: {}, params: {} }], links: [], nextId: 2 } });
const file = parseShaderGraphFile(text);
console.log('節點數：', file.graph.nodes.length);
try {
  parseShaderGraphFile('{"format":"別的格式"}');
} catch (error) {
  console.log('錯誤：', (error as Error).message);
}
```

## shaderGraphDefinition
節點圖檔轉成著色器定義（unlit），交給 `shaders.define` 註冊或 `createFromDefinition` 直接用。這裡做一個隨時間變色的節點圖。

```ts
const file: ShaderGraphFile = {
  format: 'hero-shader-graph',
  version: 1,
  graph: {
    nodes: [
      { id: 1, type: 'time', x: 0, y: 0, values: {}, params: {} },
      { id: 2, type: 'color', x: 0, y: 80, values: {}, params: { color: '#ff7a45' } },
      { id: 3, type: 'color', x: 0, y: 160, values: {}, params: { color: '#4cc9f0' } },
      { id: 4, type: 'sin', x: 150, y: 0, values: {}, params: {} },
      { id: 5, type: 'mix', x: 300, y: 80, values: {}, params: {} },
      { id: 6, type: 'output', x: 450, y: 80, values: { alpha: 1 }, params: {} },
    ],
    links: [
      { from: 1, fromPort: 'time', to: 4, toPort: 'x' },
      { from: 4, fromPort: 'out', to: 5, toPort: 't' },
      { from: 2, fromPort: 'rgb', to: 5, toPort: 'a' },
      { from: 3, fromPort: 'rgb', to: 5, toPort: 'b' },
      { from: 5, fromPort: 'out', to: 6, toPort: 'color' },
    ],
    nextId: 7,
  },
};
const def = shaderGraphDefinition(file, 'pulse');
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.mesh(world, { geometry: { icosahedron: 0.9 }, material: shaders.createFromDefinition(def) });
console.log('base：', def.base, '，uniforms：', Object.keys(def.uniforms ?? {}));
engine.start();
```

## stringifyShaderGraphFile
節點圖檔轉成文字（存檔用；只保留用到的圖片）。

```ts
const file = parseShaderGraphFile({ format: 'hero-shader-graph', version: 1, graph: { nodes: [], links: [], nextId: 1 }, assets: { 7: 'data:image/png;base64,AAAA' } });
console.log(stringifyShaderGraphFile(file));
```

## BUILTIN_CHUNKS
內建的共用程式片段，在著色器裡用 `#include <名稱>` 引用（雜訊、fresnel…）。

```ts
console.log('內建片段：', Object.keys(BUILTIN_CHUNKS).join('、'));
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
shaders.define({
  name: 'noisy',
  base: 'unlit',
  fragmentHeader: '#include <engine_noise>',
  fragment: 'float n = noise2(vUv * 8.0 + uTime); color = vec4(vec3(n), 1.0);',
});
spawn.mesh(world, { geometry: { sphere: 0.9 }, material: shaders.createMaterial('noisy') });
engine.start();
```

## EffectPresets
內建的全螢幕效果：色差、雨落窗、像素化。先 `defineEffect` 註冊，再 `createEffect` 交給後製。點畫面切換。

```ts
spawn.camera(world, { position: [0, 1.5, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
for (let i = 0; i < 5; i++) spawn.mesh(world, { geometry: { box: 0.6 }, material: `hsl(${i * 60}, 70%, 60%)`, position: [i - 2, 0, 0] });
const names = ['pixelate', 'chromaticAberration', 'rainOnWindow'] as const;
for (const n of names) shaders.defineEffect(EffectPresets[n]());
let current: CustomEffect | null = null;
let i = -1;
addEventListener('pointerdown', () => {
  if (current) postfx.removePass(current);
  current = shaders.createEffect(names[++i % names.length]);
  postfx.addPass(current, 'display');
  console.log('效果：', current.shaderName);
});
console.log('點畫面套用效果');
engine.start();
```

## glsl
`glsl.typeOf`：JavaScript 值對應的 GLSL 型別（uniform 的宣告就是這樣產生的）。

```ts
for (const v of [1, true, new Vector2(), new Color(), new Matrix4(), create.texture('textures/checker.png')]) console.log(v.constructor.name, '→', glsl.typeOf(v));
```

## register
`register.shaderChunk`：註冊自己的程式片段，所有自訂著色器都能 `#include`。

```ts
register.shaderChunk('my_palette', 'vec3 palette(float t) { return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67))); }');
shaders.define({ name: 'rainbow', base: 'unlit', fragmentHeader: '#include <my_palette>', fragment: 'color = vec4(palette(vUv.x + uTime * 0.2), 1.0);' });
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.mesh(world, { geometry: { torus: [0.7, 0.25] }, material: shaders.createMaterial('rainbow') });
engine.start();
```

## SHADER_GRAPH_FORMAT
節點圖檔的格式名稱（檔案的 format 欄位）。

```ts
console.log('節點圖檔的 format：', SHADER_GRAPH_FORMAT);
```

## ShaderPresets
內建範例著色器：溶解、全像投影、波浪。可以直接用，也是自己寫的參考。用 lil-gui 調整溶解進度。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 1.5, 4], target: [0, 0.3, 0] });
spawn.defaultLights(world);
shaders.define(ShaderPresets.dissolve({ color: 0xffa94f })).define(ShaderPresets.hologram()).define(ShaderPresets.wave());
const dissolve = shaders.createMaterial('dissolve');
spawn.mesh(world, { geometry: { torusKnot: [0.5, 0.18] }, material: dissolve, position: [-1.4, 0.5, 0] });
spawn.mesh(world, { geometry: { capsule: [0.4, 0.6] }, material: shaders.createMaterial('hologram'), position: [0, 0.5, 0] });
spawn.mesh(world, { geometry: { plane: [1.4, 1, 32, 32] }, material: shaders.createMaterial('wave'), position: [1.5, 0.5, 0] });
const gui = new GUI();
gui.add(dissolve.uniforms.progress, 'value', 0, 1, 0.01).name('溶解進度');
console.log('溶解的 uniform：', Object.keys(dissolve.uniforms).filter((k) => !k.startsWith('u')).join('、'));
engine.start();
```

## ShadersKey
系統裡用 `world.requireResource(ShadersKey)` 取得著色器庫。

```ts
console.log('和 shaders 同一個：', world.requireResource(ShadersKey) === shaders);
```

## CompiledShaderGraph
`compileShaderGraph` 的結果：頂點、片段程式，用到的貼圖、半透明、面。

```ts
const result: CompiledShaderGraph = compileShaderGraph({
  nodes: [{ id: 1, type: 'output', x: 0, y: 0, values: { alpha: 0.5 }, params: {} }],
  links: [],
  nextId: 2,
});
console.log('半透明：', result.transparent, '，用到的貼圖：', result.textures, '，片段：', result.fragment.trim().slice(0, 80));
```

## EffectDefinition
全螢幕效果的定義：名稱、uniform、片段程式（`tDiffuse` 是畫面、`uv` 座標、設定 `color`）。用 lil-gui 調整。

```ts
import GUI from 'lil-gui';

spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: '#9acd32' });
const vhs: EffectDefinition = {
  name: 'vhs',
  uniforms: { shift: 0.005, noise: 0.08 },
  header: 'float rand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }',
  fragment: `
    color.r = texture2D(tDiffuse, uv + vec2(shift, 0.0)).r;
    color.b = texture2D(tDiffuse, uv - vec2(shift, 0.0)).b;
    color.rgb += (rand(uv + uTime) - 0.5) * noise;
  `,
};
shaders.defineEffect(vhs);
const fx = shaders.createEffect('vhs');
postfx.addPass(fx, 'display');
const gui = new GUI();
gui.add(fx.uniforms.shift, 'value', 0, 0.03, 0.001).name('色偏');
gui.add(fx.uniforms.noise, 'value', 0, 0.5, 0.01).name('雜訊');
engine.start();
```

## ShaderDefinition
自訂材質的定義。`base: 'standard'` 保留光照與陰影，只改一部分：`vertex` 移動頂點、`fragment` 改 `diffuseColor`、`emissive` 讓表面發光。

```ts
spawn.camera(world, { position: [0, 1.5, 3.5], target: [0, 0, 0] });
spawn.defaultLights(world);
const def: ShaderDefinition = {
  name: 'breathing',
  base: 'standard',
  uniforms: { amount: 0.08, glow: new Color('#ff7a45') },
  options: { roughness: 0.4 },
  vertex: 'transformed += normal * sin(uTime * 3.0 + position.y * 4.0) * amount;',
  fragment: 'diffuseColor.rgb = mix(vec3(0.2, 0.6, 0.9), vec3(0.9, 0.9, 1.0), vUv.y);',
  emissive: 'totalEmissiveRadiance += glow * (0.5 + 0.5 * sin(uTime * 3.0));',
};
shaders.define(def);
spawn.mesh(world, { geometry: { sphere: [0.9, 64, 32] }, material: shaders.createMaterial('breathing') });
engine.start();
```

## ShaderGraph
節點圖：節點、連線、下一個編號（著色器編輯器編輯的就是它）。

```ts
const graph: ShaderGraph = { nodes: [{ id: 1, type: 'uv', x: 0, y: 0, values: {}, params: {} }], links: [], nextId: 2 };
graph.nodes.push({ id: graph.nextId++, type: 'output', x: 200, y: 0, values: {}, params: {} });
graph.links.push({ from: 1, fromPort: 'uv', to: 2, toPort: 'color' });
console.log(graph.nodes.length, '個節點、', graph.links.length, '條連線，下一個編號', graph.nextId);
```

## ShaderGraphFile
節點圖檔：格式、版本、節點圖、圖片、編輯器的預覽設定。

```ts
const file: ShaderGraphFile = { format: 'hero-shader-graph', version: 1, graph: { nodes: [], links: [], nextId: 1 }, preview: { mesh: 'sphere' } };
console.log(stringifyShaderGraphFile(file));
```

## ShaderGraphLink
一條連線：from 節點的某個輸出 → to 節點的某個輸入。

```ts
const link: ShaderGraphLink = { from: 1, fromPort: 'time', to: 2, toPort: 'x' };
console.log(`節點 ${link.from}.${link.fromPort} → 節點 ${link.to}.${link.toPort}`);
```

## ShaderGraphNode
節點圖裡的一個節點：編號、種類、位置、沒連接的輸入值、參數。

```ts
const node: ShaderGraphNode = { id: 1, type: 'color', x: 40, y: 80, values: {}, params: { color: '#9acd32' } };
console.log(node.type, '節點，顏色參數', node.params.color);
```

## CustomEffect
`shaders.createEffect` 建立的全螢幕效果（three.js 的 ShaderPass），交給 `postfx.addPass`。

```ts
shaders.defineEffect(EffectPresets.pixelate());
const fx: CustomEffect = shaders.createEffect('pixelate', { pixelSize: 10 });
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: '#ffa94f' });
postfx.addPass(fx, 'display');
console.log(fx.shaderName, '的 pixelSize：', fx.uniforms.pixelSize.value);
engine.start();
```

## CustomMaterial
自訂著色器建立的材質：`uniforms` 可以直接改。每個實例各自獨立（例如每個敵人各自的溶解進度）。

```ts
spawn.camera(world, { position: [0, 1.5, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
shaders.define(ShaderPresets.dissolve());
const mats: CustomMaterial[] = [];
for (let i = 0; i < 3; i++) {
  const m = shaders.createMaterial('dissolve');
  mats.push(m);
  spawn.mesh(world, { geometry: { box: 0.8 }, material: m, position: [i * 1.4 - 1.4, 0, 0] });
}
engine.on('update', (t) => mats.forEach((m, i) => (m.uniforms.progress.value = (Math.sin(t.elapsed + i) + 1) / 2)));
engine.start();
```

## ShaderBase
自訂著色器建立在哪種材質上：`unlit` 完全自訂，其他保留光照只改一部分。

```ts
spawn.camera(world, { position: [0, 1.5, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const bases: ShaderBase[] = ['unlit', 'standard', 'lambert', 'phong'];
bases.forEach((base, i) => {
  shaders.define({ name: `tint-${base}`, base, ...(base === 'unlit' ? { fragment: 'color = vec4(vUv, 0.5, 1.0);' } : { fragment: 'diffuseColor.rgb = vec3(vUv, 0.5);' }) });
  spawn.mesh(world, { geometry: { sphere: 0.45 }, material: shaders.createMaterial(`tint-${base}`), position: [i * 1.1 - 1.65, 0, 0] });
});
console.log('由左到右：', bases.join('、'), '（unlit 沒有光影）');
engine.start();
```

## UniformInput
uniform 的值：數字、布林、向量、顏色、矩陣、貼圖；陣列等需要指定型別時用 `{ value, glsl }`。

```ts
const uniforms: Record<string, UniformInput> = {
  speed: 1.5,
  tint: new Color('#ff0000'),
  offset: new Vector2(0.1, 0.2),
  points: { value: [new Vector3(), new Vector3(1, 0, 0)], glsl: 'vec3[2]' },
};
shaders.define({ name: 'uniformDemo', base: 'unlit', uniforms, fragment: 'color = vec4(tint * (0.5 + 0.5 * sin(uTime * speed + offset.x + points[1].x)), 1.0);' });
const m = shaders.createMaterial('uniformDemo');
console.log('uniform：', Object.keys(m.uniforms).filter((k) => !k.startsWith('u')));
spawn.camera(world, { position: [0, 0, 3], target: [0, 0, 0] });
spawn.mesh(world, { geometry: { box: 1 }, material: m });
engine.start();
```
