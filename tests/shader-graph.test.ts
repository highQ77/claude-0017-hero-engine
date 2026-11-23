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
import { ShaderLibrary, tsl } from '../src/shaders';
import { EXAMPLES, buildExample, createNode } from '../src/editors/shader-editor/examples';

describe('節點式著色器：編譯', () => {
  test('型別轉換：變窄取前幾個分量，變寬補 0（alpha 補 1）', () => {
    const v = { x: 'X', xy: 'XY', xyz: 'XYZ' };
    expect(convertType(v, 'vec3', 'vec3')).toBe(v);
    expect(convertType(v, 'vec4', 'float')).toBe('X');
    expect(convertType(v, 'vec4', 'vec2')).toBe('XY');
    expect(convertType(v, 'vec4', 'vec3')).toBe('XYZ');
    // 變寬：產生新的節點
    for (const [from, to] of [
      ['float', 'vec3'],
      ['vec2', 'vec3'],
      ['vec3', 'vec4'],
    ] as const)
      expect(convertType(tsl.vec3(1, 2, 3), from, to)).toBeTruthy();
  });

  test('所有範例都能編譯成引擎的自訂著色器（ShaderLibrary 接受、建立得出材質）', () => {
    const lib = new ShaderLibrary();
    for (const ex of EXAMPLES) {
      const g = buildExample(ex.id);
      const def = shaderGraphDefinition({ format: 'hero-shader-graph', version: 1, graph: g }, `ex-${ex.id}`, {
        textures: { get: () => null } as never,
      });
      lib.define(def);
      const m = lib.createMaterial(def.name) as unknown as { isNodeMaterial: boolean; colorNode: unknown };
      expect(m.isNodeMaterial).toBe(true);
      expect(m.colorNode).toBeTruthy();
      // 每個節點的縮圖也要能編譯
      for (const n of g.nodes) {
        const out = NODE_DEFS[n.type].outputs[0];
        if (out) expect(() => compileShaderGraph(g, { target: { nodeId: n.id, port: out.name } })).not.toThrow();
      }
    }
  });

  test('泛型 T：輸出取最寬的輸入；有 Vertex Output 時有頂點位移；alpha 有連接時半透明', () => {
    const g = buildExample('hologram');
    const types = analyzeShaderGraphTypes(g);
    const color = g.nodes.find((n) => n.type === 'color')!;
    const rgb = g.links.find((l) => l.from === color.id)!;
    expect(types[`${rgb.to}:out:out`]).toBe('vec3'); // vec3 × float → vec3
    expect(compileShaderGraph(g).transparent).toBe(true);

    const terrain = compileShaderGraph(buildExample('terrain'));
    expect(terrain.kind).toBe('material');
    expect(terrain.position).toBeTypeOf('function');
    expect(terrain.position!({ uniforms: {} })).toBeTruthy();
    const rings = compileShaderGraph(buildExample('rings'));
    expect(rings.transparent).toBe(false);
    expect(rings.position).toBeNull();
  });

  test('貼圖節點：列在 textures；uniform 名稱是 uTex<編號>', () => {
    const g = buildExample('textured');
    const tex = g.nodes.find((n) => n.type === 'texture')!;
    const c = compileShaderGraph(g);
    expect(c.textures).toEqual([tex.id]);
    const def = shaderGraphDefinition({ format: 'hero-shader-graph', version: 1, graph: g }, 'tex', {
      textures: { get: () => new Texture() } as never,
    });
    expect(Object.keys(def.uniforms ?? {})).toContain(`uTex${tex.id}`);
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
      expect(def.color).toBeTypeOf('function');
      lib.defineEffect(def);
      const pass = lib.createEffect(def.name);
      expect(pass.shaderName).toBe(def.name);
      expect(pass.apply(tsl.vec4(0, 0, 0, 1))).toBeTruthy();
    }
  });

  test('Effect Output 沒有連接時是畫面原本的顏色', () => {
    const g: ShaderGraph = { nodes: [], links: [], nextId: 1 };
    createNode(g, 'effectOutput', 0, 0);
    const read: unknown[] = [];
    const screenColor = tsl.vec4(0.1, 0.2, 0.3, 1);
    const c = compileShaderGraph(g);
    expect(c.kind).toBe('effect');
    c.color({
      uniforms: {},
      uv: tsl.vec2(0.5),
      screen: (uv) => {
        read.push(uv);
        return screenColor;
      },
    });
    expect(read).toHaveLength(1); // 讀了畫面原本的顏色
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

  test('效果的圖在編輯器裡預覽：變成平面材質，畫面換成指定的圖', () => {
    const lib = new ShaderLibrary();
    const screen = new Texture();
    const def = shaderGraphDefinition(fileOf(buildExample('fxVignette')), 'preview-fx', { screen });
    expect(def.uniforms?.uScreen).toBe(screen);
    expect(def.base).toBe('unlit');
    expect(lib.createFromDefinition(def)).toBeTruthy();
  });
});
