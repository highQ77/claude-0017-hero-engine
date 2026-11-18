import { describe, expect, test } from 'vitest';
import {
  NODE_DEFS,
  analyzeShaderGraphTypes,
  compileShaderGraph,
  convertType,
  normalizeShaderGraph,
  parseShaderGraphFile,
  shaderGraphDefinition,
  stringifyShaderGraphFile,
  upstreamHas,
  type ShaderGraph,
} from '../src/shaders/graph';
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
