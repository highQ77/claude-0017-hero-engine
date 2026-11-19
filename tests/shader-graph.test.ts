import { describe, expect, test } from 'vitest';
import {
  NODE_DEFS,
  analyzeShaderGraphTypes,
  compileShaderGraph,
  convertType,
  normalizeShaderGraph,
  parseShaderGraphFile,
  shaderGraphDefinition,
  shaderGraphEffectDefinition,
  shaderGraphKind,
  stringifyShaderGraphFile,
  upstreamHas,
  type ShaderGraph,
} from '../src/shaders/graph';
import { Texture } from 'three';
import { ShaderLibrary } from '../src/shaders';
import { EXAMPLES, buildExample, createNode } from '../src/editors/shader-editor/examples';

describe('節點式著色器：編譯', () => {
  test('型別轉換', () => {
    expect(convertType('a', 'float', 'vec3')).toBe('vec3(a)');
    expect(convertType('a', 'vec4', 'float')).toBe('(a).x');
    expect(convertType('a', 'vec4', 'vec2')).toBe('(a).xy');
    expect(convertType('a', 'vec2', 'vec3')).toBe('vec3(a, 0.0)');
    expect(convertType('a', 'vec3', 'vec4')).toBe('vec4(a, 1.0)');
  });

  test('所有範例都能編譯成引擎的自訂著色器（ShaderLibrary 接受、建立得出材質）', () => {
    const lib = new ShaderLibrary();
    for (const ex of EXAMPLES) {
      const g = buildExample(ex.id);
      const def = shaderGraphDefinition({ format: 'hero-shader-graph', version: 1, graph: g }, `ex-${ex.id}`, {
        textures: { get: () => null } as never,
      });
      lib.define(def);
      const m = lib.createMaterial(def.name) as unknown as { fragmentShader: string; vertexShader: string };
      expect(m.fragmentShader).toContain('color = vec4(');
      // 每個節點的縮圖也要能編譯
      for (const n of g.nodes) {
        const out = NODE_DEFS[n.type].outputs[0];
        if (out) expect(() => compileShaderGraph(g, { target: { nodeId: n.id, port: out.name } })).not.toThrow();
      }
    }
  });

  test('泛型 T：輸出取最寬的輸入；頂點位移放進頂點著色器；alpha 有連接時半透明', () => {
    const g = buildExample('hologram');
    const types = analyzeShaderGraphTypes(g);
    const color = g.nodes.find((n) => n.type === 'color')!;
    const rgb = g.links.find((l) => l.from === color.id)!;
    expect(types[`${rgb.to}:out:out`]).toBe('vec3'); // vec3 × float → vec3
    expect(compileShaderGraph(g).transparent).toBe(true);

    const terrain = compileShaderGraph(buildExample('terrain'));
    expect(terrain.vertex).toContain('transformed += normal * (');
    expect(terrain.vertexHeader).toContain('float sgFbm'); // 頂點階段用到的輔助函式
    expect(terrain.fragment).toContain('dFdx'); // 依位移重算法線
    expect(compileShaderGraph(buildExample('rings')).transparent).toBe(false);
  });

  test('貼圖節點：片段用 texture、頂點用 textureLod；uniform 名稱是 uTex<編號>', () => {
    const g = buildExample('textured');
    const tex = g.nodes.find((n) => n.type === 'texture')!;
    const c = compileShaderGraph(g);
    expect(c.textures).toEqual([tex.id]);
    expect(c.fragment).toContain(`texture(uTex${tex.id}`);
    expect(c.vertex).toContain(`textureLod(uTex${tex.id}`);
  });

  test('錯誤：沒有輸出節點、循環連線、未知節點', () => {
    const g: ShaderGraph = { nodes: [], links: [], nextId: 1 };
    expect(() => compileShaderGraph(g)).toThrow(/Fragment Output/);
    const a = createNode(g, 'sin', 0, 0);
    const b = createNode(g, 'cos', 0, 0);
    const out = createNode(g, 'output', 0, 0);
    g.links.push({ from: a.id, fromPort: 'out', to: b.id, toPort: 'x' });
    g.links.push({ from: b.id, fromPort: 'out', to: a.id, toPort: 'x' });
    g.links.push({ from: b.id, fromPort: 'out', to: out.id, toPort: 'color' });
    expect(upstreamHas(g, b.id, a.id)).toBe(true);
    expect(() => compileShaderGraph(g)).toThrow(/循環/);
    expect(() => compileShaderGraph({ ...g, nodes: [{ ...out, type: 'nope' }], links: [] })).toThrow();
  });
});

describe('節點圖檔', () => {
  test('存讀：補上預設值、去掉不認識的節點與壞掉的連線、只保留用到的圖片', () => {
    const g = buildExample('textured');
    const tex = g.nodes.find((n) => n.type === 'texture')!;
    tex.params.image = 'img_a';
    const text = stringifyShaderGraphFile({
      format: 'hero-shader-graph',
      version: 1,
      graph: g,
      assets: { img_a: 'data:image/png;base64,AA', img_unused: 'data:x' },
      preview: { mesh: 'sphere' },
    });
    const back = parseShaderGraphFile(text);
    expect(back.graph).toEqual(g);
    expect(Object.keys(back.assets!)).toEqual(['img_a']);
    expect(back.preview).toEqual({ mesh: 'sphere' });

    const messy = normalizeShaderGraph({
      nodes: [
        { id: 1, type: 'sin' },
        { id: 2, type: '不存在' },
      ],
      links: [{ from: 1, fromPort: 'out', to: 2, toPort: 'x' }],
    });
    expect(messy.nodes).toHaveLength(1);
    expect(messy.nodes[0].values).toEqual({ x: 0 });
    expect(messy.links).toEqual([]);
    expect(messy.nextId).toBe(2);
  });

  test('讀得懂 Shader Composer 匯出的 JSON', () => {
    const exported = { format: 'shader-node-editor', version: 2, graph: buildExample('rings'), assets: {} };
    expect(parseShaderGraphFile(JSON.stringify(exported)).graph.nodes.length).toBeGreaterThan(3);
    expect(() => parseShaderGraphFile('{"nodes": 1}')).toThrow(/格式不正確/);
  });
});

describe('節點式著色器：全螢幕效果（Effect Output）', () => {
  const fileOf = (graph: ShaderGraph) => ({ format: 'hero-shader-graph' as const, version: 1 as const, graph });
  const effectExamples = EXAMPLES.filter((e) => e.group === '全螢幕效果' || e.id === 'blankEffect');

  test('有 Effect Output 的圖是全螢幕效果', () => {
    expect(effectExamples.length).toBeGreaterThanOrEqual(5);
    for (const ex of effectExamples) expect(shaderGraphKind(buildExample(ex.id))).toBe('effect');
    expect(shaderGraphKind(buildExample('blank'))).toBe('material');
  });

  test('效果範例都能變成 ShaderLibrary 的效果，建立得出後製步驟', () => {
    const lib = new ShaderLibrary();
    for (const ex of effectExamples) {
      const def = shaderGraphEffectDefinition(fileOf(buildExample(ex.id)), `fx-${ex.id}`);
      // 顏色是畫面上的值：不做 sRGB 轉換；讀畫面用 tDiffuse
      expect(def.fragment).not.toContain('sRGBTransferEOTF');
      expect(def.header).toContain('#define uAspect');
      lib.defineEffect(def);
      const pass = lib.createEffect(def.name);
      expect(pass.shaderName).toBe(def.name);
      expect((pass.material as { fragmentShader: string }).fragmentShader).toContain('tDiffuse');
    }
  });

  test('Effect Output 沒有連接時是畫面原本的顏色', () => {
    const g: ShaderGraph = { nodes: [], links: [], nextId: 1 };
    createNode(g, 'effectOutput', 0, 0);
    expect(compileShaderGraph(g).fragment).toContain('texture(tDiffuse, vUv).rgb');
  });

  test('材質裡用 Screen Color 會給出清楚的錯誤', () => {
    const g: ShaderGraph = { nodes: [], links: [], nextId: 1 };
    const scr = createNode(g, 'screenColor', 0, 0);
    const out = createNode(g, 'output', 200, 0);
    g.links.push({ from: scr.id, fromPort: 'rgb', to: out.id, toPort: 'color' });
    expect(() => compileShaderGraph(g)).toThrow(/Screen Color 只能用在全螢幕效果/);
  });

  test('材質和效果的輸出不能放在同一張圖', () => {
    const g: ShaderGraph = { nodes: [], links: [], nextId: 1 };
    createNode(g, 'output', 0, 0);
    createNode(g, 'effectOutput', 200, 0);
    expect(() => compileShaderGraph(g)).toThrow(/只能是材質或全螢幕效果/);
  });

  test('材質的圖不能當效果用，反之亦然', () => {
    expect(() => shaderGraphEffectDefinition(fileOf(buildExample('blank')), 'x')).toThrow(/不是全螢幕效果/);
  });

  test('效果的圖在編輯器裡預覽：變成平面材質，畫面換成指定的圖，輸出轉成線性', () => {
    const lib = new ShaderLibrary();
    const screen = new Texture();
    const def = shaderGraphDefinition(fileOf(buildExample('fxVignette')), 'preview-fx', { screen });
    expect(def.uniforms?.uScreen).toBe(screen);
    expect(def.fragmentHeader).toContain('#define tDiffuse uScreen');
    expect(def.fragment).toContain('sRGBTransferEOTF');
    expect(lib.createFromDefinition(def)).toBeTruthy();
  });
});
