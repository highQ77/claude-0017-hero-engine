import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import {
  EffectPresets,
  ShaderLibrary,
  ShaderPlugin,
  ShaderPresets,
  ShadersKey,
  glsl,
  register,
  type CustomMaterial,
} from '../src/shaders';
import { fakeScheduler } from './helpers';

/** 模擬 three.js 編譯前的流程：取得標準材質原始碼，交給 onBeforeCompile */
function compileLit(material: THREE.Material, lib: 'standard' | 'basic' = 'standard') {
  const src = THREE.ShaderLib[lib];
  const shader = {
    uniforms: THREE.UniformsUtils.clone(src.uniforms),
    vertexShader: src.vertexShader,
    fragmentShader: src.fragmentShader,
  } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
}

/** 展開 #include（和 three.js 相同規則），確認每個片段都存在 */
function resolveIncludes(source: string, depth = 0): string {
  if (depth > 10) throw new Error('include 太深');
  return source.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_m, name: string) => {
    const chunk = (THREE.ShaderChunk as Record<string, string>)[name];
    if (chunk === undefined) throw new Error(`找不到片段 <${name}>`);
    return resolveIncludes(chunk, depth + 1);
  });
}

describe('uniform 型別推斷', () => {
  test('常見型別', () => {
    expect(glsl.typeOf(1)).toBe('float');
    expect(glsl.typeOf(true)).toBe('bool');
    expect(glsl.typeOf(new THREE.Color())).toBe('vec3');
    expect(glsl.typeOf(new THREE.Vector2())).toBe('vec2');
    expect(glsl.typeOf(new THREE.Vector4())).toBe('vec4');
    expect(glsl.typeOf(new THREE.Matrix4())).toBe('mat4');
    expect(glsl.typeOf(new THREE.Texture())).toBe('sampler2D');
    expect(glsl.typeOf(null)).toBe('sampler2D');
    expect(() => glsl.typeOf('x', 'name')).toThrow(/無法推斷 uniform「name」/);
  });
});

describe('完全自訂材質（unlit）', () => {
  test('產生的原始碼包含宣告、內建變數與開發者的程式碼', () => {
    const lib = new ShaderLibrary();
    lib.define({
      name: 'flat',
      base: 'unlit',
      uniforms: { tint: new THREE.Color(1, 0, 0), strength: 0.5, weights: { value: [0, 0, 0, 0], glsl: 'float[4]' } },
      vertex: 'transformed.y += strength;',
      fragment: 'color = vec4(tint, 1.0);',
      options: { transparent: true },
    });
    const m = lib.createMaterial('flat') as unknown as THREE.ShaderMaterial & CustomMaterial;
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    expect(m.transparent).toBe(true);
    expect(m.vertexShader).toContain('uniform vec3 tint;');
    expect(m.vertexShader).toContain('uniform float weights[4];');
    expect(m.vertexShader).toContain('transformed.y += strength;');
    expect(m.fragmentShader).toContain('color = vec4(tint, 1.0);');
    expect(m.fragmentShader).toContain('uniform float uTime;');
    expect(m.fragmentShader).toContain('varying vec3 vWorldPosition;');
    expect(() => resolveIncludes(m.fragmentShader)).not.toThrow();
    expect(m.shaderName).toBe('flat');
  });

  test('每個實例的 uniform 各自獨立；內建 uniform 共用', () => {
    const lib = new ShaderLibrary();
    lib.define({ name: 'a', base: 'unlit', uniforms: { tint: new THREE.Color(1, 1, 1), amount: 1 } });
    const m1 = lib.createMaterial('a');
    const m2 = lib.createMaterial('a', { amount: 5 });
    (m1.uniforms.tint.value as THREE.Color).set(0xff0000);
    expect((m2.uniforms.tint.value as THREE.Color).getHex()).toBe(0xffffff);
    expect([m1.uniforms.amount.value, m2.uniforms.amount.value]).toEqual([1, 5]);
    expect(m1.uniforms.uTime).toBe(m2.uniforms.uTime);
    lib.builtins.uTime.value = 3;
    expect(m1.uniforms.uTime.value).toBe(3);
    expect(() => lib.createMaterial('a', { nope: 1 })).toThrow(/沒有 uniform「nope」/);
  });
});

describe('擴充標準材質', () => {
  test('程式碼插入在正確位置，保留 three.js 原本的光照', () => {
    const lib = new ShaderLibrary();
    lib.define({
      name: 'lit',
      base: 'standard',
      options: { roughness: 0.3, color: 0x336699 },
      uniforms: { glow: 2 },
      vertex: '/*V*/ transformed.x += 1.0;',
      fragment: '/*F*/ diffuseColor.rgb *= 0.5;',
      emissive: '/*E*/ totalEmissiveRadiance += vec3(glow);',
      output: '/*O*/ gl_FragColor.a = 1.0;',
    });
    const m = lib.createMaterial('lit') as CustomMaterial & THREE.MeshStandardMaterial;
    expect(m).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(m.roughness).toBe(0.3);
    expect(m.color.getHex()).toBe(0x336699);

    const shader = compileLit(m);
    const vs = shader.vertexShader;
    const fs = shader.fragmentShader;
    const after = (src: string, anchor: string, marker: string) =>
      expect(src.indexOf(marker)).toBeGreaterThan(src.indexOf(`#include <${anchor}>`));
    after(vs, 'begin_vertex', '/*V*/');
    expect(vs.indexOf('/*V*/')).toBeLessThan(vs.indexOf('#include <project_vertex>'));
    after(fs, 'color_fragment', '/*F*/');
    after(fs, 'emissivemap_fragment', '/*E*/');
    after(fs, 'opaque_fragment', '/*O*/');
    expect(fs.indexOf('/*O*/')).toBeLessThan(fs.indexOf('#include <tonemapping_fragment>'));
    expect(fs).toContain('#include <lights_fragment_begin>'); // 光照還在
    expect(shader.uniforms.glow).toBe(m.uniforms.glow);
    expect(shader.uniforms.uTime).toBe(lib.builtins.uTime);
    expect(() => resolveIncludes(vs)).not.toThrow();
    expect(() => resolveIncludes(fs)).not.toThrow();
    expect(m.customProgramCacheKey()).toBe('lit:0');

    // 每個實例可以有自己的材質參數
    const red = lib.createMaterial('lit', {}, { color: 0xff0000 }) as CustomMaterial & THREE.MeshStandardMaterial;
    expect(red.color.getHex()).toBe(0xff0000);
    expect(red.roughness).toBe(0.3);
  });

  test('basic 材質不支援 emissive；不存在的插入點會清楚報錯', () => {
    const lib = new ShaderLibrary();
    expect(() => lib.define({ name: 'x', base: 'basic', emissive: 'a' })).toThrow(/沒有自發光/);
    lib.define({ name: 'y', base: 'basic', fragment: 'diffuseColor.r = 1.0;' });
    expect(() => compileLit(lib.createMaterial('y'), 'basic')).not.toThrow();
  });

  test('內建 uniform 名稱不能拿來用；重複註冊報錯；材質與效果不能混用', () => {
    const lib = new ShaderLibrary();
    expect(() => lib.define({ name: 'z', base: 'unlit', uniforms: { uTime: 1 } })).toThrow(/內建/);
    lib.define({ name: 'z', base: 'unlit' });
    expect(() => lib.define({ name: 'z', base: 'unlit' })).toThrow(/已註冊/);
    expect(() => lib.createEffect('z')).toThrow(/是材質，不是效果/);
    expect(() => lib.createMaterial('missing')).toThrow(/找不到著色器「missing」/);
  });
});

describe('執行中更新', () => {
  test('unlit：所有實例換上新程式碼、保留舊值、加入新 uniform', () => {
    const lib = new ShaderLibrary();
    lib.define({ name: 'u', base: 'unlit', uniforms: { a: 1 }, fragment: 'color = vec4(1.0);' });
    const m = lib.createMaterial('u') as unknown as THREE.ShaderMaterial & CustomMaterial;
    m.uniforms.a.value = 7;
    const version = m.version;
    lib.update('u', { fragment: 'color = vec4(a, b, 0.0, 1.0);', uniforms: { a: 1, b: 2 } });
    expect(m.fragmentShader).toContain('color = vec4(a, b, 0.0, 1.0);');
    expect(m.fragmentShader).toContain('uniform float b;');
    expect(m.uniforms.a.value).toBe(7);
    expect(m.uniforms.b.value).toBe(2);
    expect(m.version).toBeGreaterThan(version); // needsUpdate
  });

  test('標準材質：快取鍵改變，重新編譯時用新定義', () => {
    const lib = new ShaderLibrary();
    lib.define({ name: 's', base: 'standard', fragment: '/*OLD*/' });
    const m = lib.createMaterial('s');
    lib.update('s', { fragment: '/*NEW*/' });
    expect(m.customProgramCacheKey()).toBe('s:1');
    const fs = compileLit(m).fragmentShader;
    expect(fs).toContain('/*NEW*/');
    expect(fs).not.toContain('/*OLD*/');
  });

  test('釋放的材質不再追蹤', () => {
    const lib = new ShaderLibrary();
    lib.define({ name: 'd', base: 'unlit' });
    const m = lib.createMaterial('d');
    expect(lib.liveCount('d')).toBe(1);
    m.dispose();
    expect(lib.liveCount('d')).toBe(0);
  });
});

describe('全螢幕效果', () => {
  test('包成 ShaderPass，自動提供 color、uv、tDiffuse', () => {
    const lib = new ShaderLibrary();
    lib.defineEffect({
      name: 'invert',
      uniforms: { mixAmount: 1 },
      fragment: 'color.rgb = mix(color.rgb, 1.0 - color.rgb, mixAmount);',
    });
    const pass = lib.createEffect('invert', { mixAmount: 0.5 });
    const material = pass.material as THREE.ShaderMaterial;
    expect(material.fragmentShader).toContain('vec4 color = texture2D(tDiffuse, uv);');
    expect(material.fragmentShader).toContain('mix(color.rgb, 1.0 - color.rgb, mixAmount)');
    expect(pass.uniforms.mixAmount.value).toBe(0.5);
    expect(pass.uniforms.uResolution).toBe(lib.builtins.uResolution);

    lib.update('invert', { fragment: 'color.rgb = vec3(0.0);' });
    expect(material.fragmentShader).toContain('color.rgb = vec3(0.0);');
  });
});

describe('共用片段與內建範例', () => {
  test('自訂片段可被 #include；名稱檢查', () => {
    register.shaderChunk('my_helpers', 'float double_it(float x) { return x * 2.0; }');
    expect(resolveIncludes('#include <my_helpers>')).toContain('double_it');
    expect(() => register.shaderChunk('bad name', '')).toThrow();
  });

  test('所有內建範例都能註冊、建立，且 include 都找得到', () => {
    const lib = new ShaderLibrary();
    for (const def of [ShaderPresets.dissolve(), ShaderPresets.hologram(), ShaderPresets.wave()]) {
      lib.define(def);
      const m = lib.createMaterial(def.name);
      const sources =
        m instanceof THREE.ShaderMaterial
          ? [m.vertexShader, m.fragmentShader]
          : (() => {
              const s = compileLit(m);
              return [s.vertexShader, s.fragmentShader];
            })();
      for (const src of sources) expect(() => resolveIncludes(src)).not.toThrow();
    }
    for (const def of [EffectPresets.chromaticAberration(), EffectPresets.pixelate()]) {
      lib.defineEffect(def);
      expect(() =>
        resolveIncludes((lib.createEffect(def.name).material as THREE.ShaderMaterial).fragmentShader),
      ).not.toThrow();
    }
  });
});

describe('ShaderPlugin', () => {
  test('每幀更新 uTime 與 uDeltaTime；可從 ECS 取得', () => {
    const clock = fakeScheduler();
    const ecs = new EcsPlugin();
    const plugin = new ShaderPlugin();
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    engine.use(ecs).use(plugin);
    engine.start();
    clock.frame(50);
    clock.frame(50);
    const lib = ecs.world.requireResource(ShadersKey);
    expect(lib.builtins.uTime.value).toBeCloseTo(0.1, 5);
    expect(lib.builtins.uDeltaTime.value).toBeCloseTo(0.05, 5);
  });
});
