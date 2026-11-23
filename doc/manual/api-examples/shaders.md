# @engine/shaders 的範例

## ShaderLibrary
著色器庫（`shaders`）：`define` 註冊自訂材質，`createMaterial` 建立實例（uniform 各自獨立），`update` 執行中修改。著色器用 TSL 節點寫（`tsl` 裡的函式），WebGPU 與 WebGL2 備援都能跑。用 lil-gui 調整 uniform。

```ts
import GUI from 'lil-gui';

const { vec4, mix, step, fract } = tsl;
spawn.camera(world, { position: [0, 1, 3.5], target: [0, 0, 0] });
spawn.defaultLights(world);
shaders.define({
  name: 'stripes',
  base: 'unlit',
  uniforms: { colorA: new Color('#ff6b6b'), colorB: new Color('#4cc9f0'), count: 10, speed: 1 },
  color: (c) => {
    const u = c.uniforms;
    const s = step(0.5, fract(c.uv.y.mul(u.count).add(c.time.mul(u.speed))));
    return vec4(mix(u.colorA, u.colorB, s), 1);
  },
});
const mat = shaders.createMaterial('stripes');
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: mat });
const gui = new GUI();
gui.add(mat.uniforms.count, 'value', 1, 40, 1).name('條紋數');
gui.add(mat.uniforms.speed, 'value', -3, 3, 0.1).name('速度');
gui.addColor(mat.uniforms.colorA, 'value').name('顏色 A');
const diagonal = () =>
  shaders.update('stripes', {
    color: (c: ShaderContext) => {
      const u = c.uniforms;
      const s = step(0.5, fract(c.uv.x.add(c.uv.y).mul(u.count).add(c.time.mul(u.speed))));
      return vec4(mix(u.colorA, u.colorB, s), 1);
    },
  });
gui.add({ diagonal }, 'diagonal').name('改成斜線（update）');
console.log('使用中的實例：', shaders.liveCount('stripes'));
engine.start();
```

## ShaderPlugin
著色器外掛（`shaderPlugin`）：提供著色器庫，並讓材質描述可以寫 `{ shaderGraph: '…' }`。時間、畫面大小（`c.time`、`c.resolution`）由 three.js 每幀自動更新。

```ts
console.log('外掛：', shaderPlugin.name, '，著色器庫：', shaderPlugin.library === shaders);
console.log('已定義：', shaders.names.join('、') || '（還沒有）');
```

## compileShaderGraph
把節點圖編譯成 TSL 節點（3D 場景編輯器、著色器編輯器內部用）。這裡用程式組一張「UV 漸層」的圖，看編譯結果。

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
console.log('種類：', compiled.kind, '，半透明：', compiled.transparent, '，面：', compiled.side);
console.log('有頂點位移：', compiled.position !== null);
```

## defineShaderNode
新增一種節點（著色器編輯器的節點庫也會出現）。`tsl` 函式拿到各輸入的節點，回傳各輸出的節點。這裡做一個「棋盤格」節點，再用它組一張圖。

```ts
const { floor, mod } = tsl;
defineShaderNode({
  type: 'checker',
  title: '棋盤格',
  category: 'pattern',
  inputs: [{ name: 'scale', type: 'float', default: 8 }],
  outputs: [{ name: 'out', type: 'float' }],
  tsl: (i, _params, _T, ctx) => {
    const p = ctx.builtin('uv').mul(i.scale);
    return { out: mod(floor(p.x).add(floor(p.y)), 2) };
  },
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

## loadShaderGraphEffect
載入著色器編輯器做的全螢幕效果（節點圖裡有 Effect Output），轉成效果的定義：`shaders.defineEffect` 註冊後，`shaders.createEffect` 建立、交給後製。也可以直接寫在 `postfx.settings.effects`。

```ts
spawn.camera(world, { position: [0, 1.5, 4], target: [0, 0.5, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.7, 0.25] }, material: '#9acd32', position: [0, 0.8, 0] });
const def = await loadShaderGraphEffect('shaders/crt.shader.json'); // 名稱預設是檔名：crt
shaders.defineEffect(def);
postfx.addPass(shaders.createEffect(def.name), 'display');
console.log('效果：', def.name, '，uniform：', Object.keys(def.uniforms ?? {}).join('、'));
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

## shaderGraphEffectDefinition
全螢幕效果的節點圖（Effect Output）轉成效果的定義。`Screen Color` 讀取畫面原本的顏色，這裡用程式組一張「畫面上下顛倒＋偏紅」的圖。

```ts
spawn.camera(world, { position: [0, 1.5, 4], target: [0, 0.5, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { box: 1 }, material: '#4cc9f0', position: [0, 1, 0] });
const graph: ShaderGraph = {
  nodes: [
    { id: 1, type: 'uv', x: 0, y: 0, values: {}, params: {} },
    { id: 2, type: 'oneMinus', x: 200, y: 0, values: {}, params: {} },
    { id: 3, type: 'screenColor', x: 400, y: 0, values: {}, params: {} },
    { id: 4, type: 'multiply', x: 600, y: 0, values: {}, params: {} },
    { id: 5, type: 'color', x: 400, y: 200, values: {}, params: { color: '#ffb0a0' } },
    { id: 6, type: 'effectOutput', x: 800, y: 0, values: { alpha: 1 }, params: {} },
  ],
  links: [
    { from: 1, fromPort: 'uv', to: 2, toPort: 'x' },
    { from: 2, fromPort: 'out', to: 3, toPort: 'uv' },
    { from: 3, fromPort: 'rgb', to: 4, toPort: 'a' },
    { from: 5, fromPort: 'rgb', to: 4, toPort: 'b' },
    { from: 4, fromPort: 'out', to: 6, toPort: 'color' },
  ],
  nextId: 7,
};
const def = shaderGraphEffectDefinition({ format: 'hero-shader-graph', version: 1, graph }, 'upsideDown');
shaders.defineEffect(def);
postfx.addPass(shaders.createEffect('upsideDown'), 'display');
console.log('效果：', def.name, '，uniform：', Object.keys(def.uniforms ?? {}).join('、'));
engine.start();
```

## stringifyShaderGraphFile
節點圖檔轉成文字（存檔用；只保留用到的圖片）。

```ts
const file = parseShaderGraphFile({ format: 'hero-shader-graph', version: 1, graph: { nodes: [], links: [], nextId: 1 }, assets: { 7: 'data:image/png;base64,AAAA' } });
console.log(stringifyShaderGraphFile(file));
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
console.log('溶解的 uniform：', Object.keys(dissolve.uniforms).join('、'));
engine.start();
```

## ShadersKey
系統裡用 `world.requireResource(ShadersKey)` 取得著色器庫。

```ts
console.log('和 shaders 同一個：', world.requireResource(ShadersKey) === shaders);
```

## CompiledShaderGraph
`compileShaderGraph` 的結果：材質或效果、用到的貼圖、半透明、面，以及產生顏色（`color`）、頂點位置（`position`）節點的函式。

```ts
const result: CompiledShaderGraph = compileShaderGraph({
  nodes: [{ id: 1, type: 'output', x: 0, y: 0, values: { alpha: 0.5 }, params: {} }],
  links: [],
  nextId: 2,
});
console.log('種類：', result.kind, '，半透明：', result.transparent, '，用到的貼圖：', result.textures);
console.log('顏色節點：', result.color({ uniforms: {} }) ? '有' : '沒有');
```

## EffectDefinition
全螢幕效果的定義：名稱、uniform、`color` 函式（`c.color` 是畫面原本的顏色，`c.sample(uv)` 讀畫面任意位置，`c.uv` 左下是 (0, 0)）。用 lil-gui 調整。

```ts
import GUI from 'lil-gui';

const { vec2, vec4 } = tsl;
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: '#9acd32' });
const vhs: EffectDefinition = {
  name: 'vhs',
  uniforms: { shift: 0.005, noise: 0.08 },
  color: (c) => {
    const u = c.uniforms;
    const offset = vec2(u.shift, 0);
    const r = c.sample(c.uv.add(offset)).r;
    const b = c.sample(c.uv.sub(offset)).b;
    const grain = c.fn.hash12(c.uv.mul(c.resolution).add(c.time.mul(60))).sub(0.5).mul(u.noise);
    return vec4(r.add(grain), c.color.g.add(grain), b.add(grain), c.color.a);
  },
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
自訂材質的定義。`base: 'standard'` 保留光照與陰影，只改一部分：`position` 移動頂點、`color` 改表面顏色、`emissive` 讓表面發光（都是回傳 TSL 節點的函式）。

```ts
const { mix, sin, vec3, vec4 } = tsl;
spawn.camera(world, { position: [0, 1.5, 3.5], target: [0, 0, 0] });
spawn.defaultLights(world);
const def: ShaderDefinition = {
  name: 'breathing',
  base: 'standard',
  uniforms: { amount: 0.08, glow: new Color('#ff7a45') },
  options: { roughness: 0.4 },
  position: (c) => c.position.add(c.normal.mul(sin(c.time.mul(3).add(c.position.y.mul(4))).mul(c.uniforms.amount))),
  color: (c) => vec4(mix(vec3(0.2, 0.6, 0.9), vec3(0.9, 0.9, 1), c.uv.y), 1),
  emissive: (c) => c.uniforms.glow.mul(sin(c.time.mul(3)).mul(0.5).add(0.5)),
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
`shaders.createEffect` 建立的全螢幕效果（`PostFxPass`），交給 `postfx.addPass`。`uniforms` 可以隨時改。

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
自訂著色器建立在哪種材質上：`unlit` 完全自訂（沒有光影），其他保留光照只改一部分。

```ts
const { vec4 } = tsl;
spawn.camera(world, { position: [0, 1.5, 4], target: [0, 0, 0] });
spawn.defaultLights(world);
const bases: ShaderBase[] = ['unlit', 'standard', 'lambert', 'phong'];
bases.forEach((base, i) => {
  shaders.define({ name: `tint-${base}`, base, color: (c) => vec4(c.uv, 0.5, 1) });
  spawn.mesh(world, { geometry: { sphere: 0.45 }, material: shaders.createMaterial(`tint-${base}`), position: [i * 1.1 - 1.65, 0, 0] });
});
console.log('由左到右：', bases.join('、'), '（unlit 沒有光影）');
engine.start();
```

## UniformInput
uniform 的值：數字、布林、向量、顏色、矩陣、貼圖（`null` 是之後才給的貼圖）。

```ts
const { sin, vec4 } = tsl;
const uniforms: Record<string, UniformInput> = {
  speed: 1.5,
  tint: new Color('#ff0000'),
  offset: new Vector2(0.1, 0.2),
};
shaders.define({
  name: 'uniformDemo',
  base: 'unlit',
  uniforms,
  color: (c) => vec4(c.uniforms.tint.mul(sin(c.time.mul(c.uniforms.speed).add(c.uniforms.offset.x)).mul(0.5).add(0.5)), 1),
});
const m = shaders.createMaterial('uniformDemo');
console.log('uniform：', Object.keys(m.uniforms));
spawn.camera(world, { position: [0, 0, 3], target: [0, 0, 0] });
spawn.mesh(world, { geometry: { box: 1 }, material: m });
engine.start();
```

## shaderFns
共用的著色器函式（雜訊、Voronoi、菲涅耳、HSV、調色盤…），回傳 TSL 節點。自訂著色器裡也可以用 `c.fn`（同一份）。

```ts
const { vec3, vec4 } = tsl;
spawn.camera(world, { position: [0, 0, 3], target: [0, 0, 0] });
shaders.define({
  name: 'marble',
  base: 'unlit',
  color: (c) => {
    const n = shaderFns.fbm2(c.uv.mul(6).add(c.time.mul(0.2)));
    const col = shaderFns.palette(n, vec3(0.5), vec3(0.5), vec3(1), vec3(0, 0.33, 0.67));
    return vec4(col, 1);
  },
});
spawn.mesh(world, { geometry: { sphere: 0.9 }, material: shaders.createMaterial('marble') });
console.log('函式：', Object.keys(shaderFns).join('、'));
engine.start();
```

## tsl
three.js 的 TSL（著色器節點語言）函式：`vec3`、`mix`、`sin`、`uniform`…。遊戲不要直接 import `three/tsl`，用這一份（型別比較寬鬆，方便鏈式寫法）。

```ts
const { vec4, sin, abs } = tsl;
spawn.camera(world, { position: [0, 0, 3], target: [0, 0, 0] });
shaders.define({
  name: 'pulse',
  base: 'unlit',
  color: (c) => vec4(abs(sin(c.time.add(c.uv.x.mul(6)))), c.uv.y, 0.6, 1),
});
spawn.mesh(world, { geometry: { plane: [2, 2] }, material: shaders.createMaterial('pulse') });
engine.start();
```

## EffectContext
效果的 `color` 函式拿到的東西：`color`（畫面原本的顏色）、`uv`（左下 (0, 0)）、`sample(uv)`（讀畫面任意位置）、`time`、`resolution`、`uniforms`、`fn`。

```ts
const { vec4, length } = tsl;
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: '#4cc9f0' });
const spotlight = (c: EffectContext) => {
  const d = length(c.uv.sub(0.5));
  return vec4(c.color.rgb.mul(d.mul(-2).add(1.2)), c.color.a);
};
shaders.defineEffect({ name: 'spotlight', color: spotlight });
postfx.addPass(shaders.createEffect('spotlight'), 'display');
engine.start();
```

## PostFxPass
後製的一個效果：`apply` 拿到前一個效果的顏色（節點），回傳新的顏色。自己寫效果時實作這個介面，交給 `postfx.addPass`。`version` 改變時後製會重建。

```ts
const { vec3, vec4, dot } = tsl;
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.6, 0.2] }, material: '#ff7a45' });
const grayscale: PostFxPass = {
  enabled: true,
  apply: (input) => vec4(vec3(dot(input.rgb, vec3(0.299, 0.587, 0.114))), input.a),
};
postfx.addPass(grayscale, 'display');
addEventListener('pointerdown', () => {
  grayscale.enabled = !grayscale.enabled;
  console.log('灰階：', grayscale.enabled);
});
console.log('點畫面切換灰階');
engine.start();
```

## ShaderContext
自訂材質的函式拿到的東西（都是 TSL 節點）：`uniforms`、`time`、`uv`、`position`、`normal`、`worldPosition`、`worldNormal`、`cameraPosition`、`viewDir`、`resolution`、`fn`。

```ts
const { vec3, vec4 } = tsl;
spawn.camera(world, { position: [0, 1, 3], target: [0, 0, 0] });
const rim = (c: ShaderContext) => vec4(vec3(0.1, 0.6, 1).mul(c.fn.fresnel(c.viewDir, c.worldNormal, 3)), 1);
shaders.define({ name: 'rim', base: 'unlit', color: rim });
spawn.mesh(world, { geometry: { sphere: 0.9 }, material: shaders.createMaterial('rim') });
engine.start();
```

## ShaderNode
TSL 節點的型別（寬鬆的型別：可以直接 `.mul()`、`.add()`、取 `.x`、`.rgb`）。自己寫輔助函式時用。

```ts
const { vec4, smoothstep } = tsl;
const circle = (uv: ShaderNode, radius: number): ShaderNode => smoothstep(radius, radius - 0.01, uv.sub(0.5).length());
spawn.camera(world, { position: [0, 0, 3], target: [0, 0, 0] });
shaders.define({ name: 'dot', base: 'unlit', color: (c) => vec4(circle(c.uv, 0.3), 0.4, 0.8, 1) });
spawn.mesh(world, { geometry: { plane: [2, 2] }, material: shaders.createMaterial('dot') });
engine.start();
```

## UniformNode
一個 uniform：可以放進著色器的節點，也可以改 `.value`（下一幀生效）。`material.uniforms`、`effect.uniforms` 裡的都是。

```ts
const { vec4 } = tsl;
spawn.camera(world, { position: [0, 0, 3], target: [0, 0, 0] });
shaders.define({ name: 'fade', base: 'unlit', uniforms: { level: 0 }, color: (c) => vec4(c.uniforms.level, 0.5, 0.2, 1) });
const m = shaders.createMaterial('fade');
const level: UniformNode = m.uniforms.level;
spawn.mesh(world, { geometry: { box: 1 }, material: m });
engine.on('update', (t) => (level.value = (Math.sin(t.elapsed * 2) + 1) / 2));
engine.start();
```
