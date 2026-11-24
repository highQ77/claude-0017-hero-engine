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
  shaderGraphParams,
  stringifyShaderGraphFile,
  upstreamHas,
  type ShaderGraph,
} from '../src/shaders/graph';
import { Color, Texture } from 'three';
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
  const effectExamples = EXAMPLES.filter((e) => e.group.endsWith('全螢幕效果') || e.id === 'blankEffect');

  test('有 Effect Output 的圖是全螢幕效果', () => {
    expect(effectExamples.length).toBeGreaterThanOrEqual(9);
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

describe('節點式著色器：參數、光照、混合（對照程式版的內建效果）', () => {
  const fileOf = (graph: ShaderGraph) => ({ format: 'hero-shader-graph' as const, version: 1 as const, graph });

  test('參數節點變成 uniform：數值是數字，顏色是線性的 THREE.Color；同名的只有一個', () => {
    const g: ShaderGraph = { nodes: [], links: [], nextId: 1 };
    const a = createNode(g, 'floatParam', 0, 0, { params: { name: 'progress', value: 0.25 } });
    createNode(g, 'floatParam', 0, 100, { params: { name: 'progress', value: 9 } });
    const c = createNode(g, 'colorParam', 0, 200, { params: { name: 'tint', color: '#ff8000' } });
    const mul = createNode(g, 'multiply', 200, 0);
    const out = createNode(g, 'output', 400, 0);
    g.links.push(
      { from: c.id, fromPort: 'rgb', to: mul.id, toPort: 'a' },
      { from: a.id, fromPort: 'value', to: mul.id, toPort: 'b' },
      { from: mul.id, fromPort: 'out', to: out.id, toPort: 'color' },
    );
    expect(shaderGraphParams(g)).toEqual([
      { name: 'progress', kind: 'float', value: 0.25 },
      { name: 'tint', kind: 'color', value: '#ff8000' },
    ]);
    const def = shaderGraphDefinition(fileOf(g), 'p', { textures: { get: () => null } as never });
    expect(def.uniforms?.progress).toBe(0.25);
    expect(def.uniforms?.tint).toBeInstanceOf(Color);
    expect((def.uniforms!.tint as Color).getHexString()).toBe('ff8000');
    const m = new ShaderLibrary().createFromDefinition(def, { progress: 0.5 });
    expect(m.uniforms.progress.value).toBe(0.5);
  });

  test('參數名稱不能用時給出清楚的錯誤', () => {
    const bad = (name: string, extra?: (g: ShaderGraph) => void) => {
      const g: ShaderGraph = { nodes: [], links: [], nextId: 1 };
      createNode(g, 'floatParam', 0, 0, { params: { name } });
      extra?.(g);
      createNode(g, 'output', 200, 0);
      return () => compileShaderGraph(g);
    };
    expect(bad('')).toThrow(/英文字母開頭/);
    expect(bad('1abc')).toThrow(/英文字母開頭/);
    expect(bad('uMouse')).toThrow(/節點圖自己用的/);
    expect(bad('uTex3')).toThrow(/節點圖自己用的/);
    expect(bad('a', (g) => createNode(g, 'colorParam', 0, 100, { params: { name: 'a' } }))).toThrow(/同名的參數/);
    expect(bad('ok')).not.toThrow();
  });

  test('效果的參數：effect.uniforms 拿得到，也能在建立時覆蓋', () => {
    const def = shaderGraphEffectDefinition(fileOf(buildExample('presetRain')), 'rain');
    expect(Object.keys(def.uniforms ?? {})).toEqual(
      expect.arrayContaining(['amount', 'speed', 'scale', 'distortion', 'fog', 'darken']),
    );
    const lib = new ShaderLibrary().defineEffect(def);
    const fx = lib.createEffect('rain', { amount: 0.3 });
    expect(fx.uniforms.amount.value).toBe(0.3);
    expect(fx.apply(tsl.vec4(0, 0, 0, 1))).toBeTruthy();
  });

  test('光照選標準：建立在標準材質上，有發光、裁切、粗糙度', () => {
    const c = compileShaderGraph(buildExample('presetDissolve'));
    expect(c.lighting).toBe('standard');
    expect(c.alphaClip).toBe(true);
    expect(c.transparent).toBe(false); // 裁切是不透明材質
    expect(c.emissive).toBeTypeOf('function');
    const def = shaderGraphDefinition(fileOf(buildExample('presetDissolve')), 'd', {
      textures: { get: () => null } as never,
    });
    expect(def.base).toBe('standard');
    expect(def.options).toMatchObject({ alphaTest: 0.5, roughness: 0.35, toneMapped: true });
    const m = new ShaderLibrary().createFromDefinition(def) as unknown as {
      type: string;
      emissiveNode: unknown;
      alphaTest: number;
      uniforms: Record<string, unknown>;
    };
    expect(m.type).toBe('MeshStandardNodeMaterial');
    expect(m.emissiveNode).toBeTruthy();
    expect(m.alphaTest).toBe(0.5);
    expect(Object.keys(m.uniforms)).toEqual(expect.arrayContaining(['progress', 'edgeWidth', 'edgeColor']));
  });

  test('疊加混合：半透明、不寫深度；沒有選光照時和以前一樣是 unlit', () => {
    const def = shaderGraphDefinition(fileOf(buildExample('presetHologram')), 'h', {
      textures: { get: () => null } as never,
    });
    expect(def.base).toBe('unlit');
    expect(def.emissive).toBeUndefined();
    expect(def.options).toMatchObject({ blending: 'additive', transparent: true, depthWrite: false, side: 'double' });
    const m = new ShaderLibrary().createFromDefinition(def);
    expect(m.blending).toBe(2); // THREE.AdditiveBlending
    // 舊的圖（沒有新參數）：補上預設值，結果不變
    const old = parseShaderGraphFile({ graph: { nodes: [{ id: 1, type: 'output', x: 0, y: 0 }], links: [] } });
    const c = compileShaderGraph(old.graph);
    expect([c.lighting, c.blending, c.alphaClip, c.transparent]).toEqual(['unlit', 'normal', false, false]);
  });

  test('Screen Blur、Rain Drops：材質裡用 Screen Blur 會給出清楚的錯誤；Rain Drops 材質也能用', () => {
    const g: ShaderGraph = { nodes: [], links: [], nextId: 1 };
    const blur = createNode(g, 'screenBlur', 0, 0);
    const out = createNode(g, 'output', 200, 0);
    g.links.push({ from: blur.id, fromPort: 'rgb', to: out.id, toPort: 'color' });
    expect(() => compileShaderGraph(g)).toThrow(/Screen Blur 只能用在全螢幕效果/);
    const r: ShaderGraph = { nodes: [], links: [], nextId: 1 };
    const rain = createNode(r, 'rainDrops', 0, 0);
    const o = createNode(r, 'output', 200, 0);
    r.links.push({ from: rain.id, fromPort: 'height', to: o.id, toPort: 'color' });
    expect(() => compileShaderGraph(r)).not.toThrow();
  });
});
