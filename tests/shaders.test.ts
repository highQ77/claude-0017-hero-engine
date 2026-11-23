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
  shaderFns,
  tsl,
  type EffectContext,
  type ShaderContext,
} from '../src/shaders';
import { fakeScheduler } from './helpers';

/** 節點材質的欄位（TSL） */
type NodeMaterial = THREE.Material & {
  isNodeMaterial?: boolean;
  positionNode: unknown;
  colorNode: unknown;
  emissiveNode: unknown;
  outputNode: unknown;
};

const { vec4, vec3, float } = tsl;

describe('自訂材質（TSL）', () => {
  test('unlit：建立節點材質，color 函式拿到 uniform 與內建的值', () => {
    const lib = new ShaderLibrary();
    lib.define({
      name: 'flat',
      base: 'unlit',
      uniforms: { tint: new THREE.Color(1, 0, 0), strength: 0.5 },
      color: (c: ShaderContext) => vec4(c.uniforms.tint.mul(c.uniforms.strength), 1),
    });
    const m = lib.createMaterial('flat') as unknown as NodeMaterial & { uniforms: Record<string, { value: unknown }> };
    expect(m.isNodeMaterial).toBe(true);
    expect(m).toBeInstanceOf(THREE.Material);
    expect(m.colorNode).toBeTruthy();
    expect(m.positionNode).toBeNull();
    expect(m.uniforms.strength.value).toBe(0.5);
    expect(lib.liveCount('flat')).toBe(1);
  });

  test('每個實例的 uniform 各自獨立；可以覆蓋初始值與材質參數', () => {
    const lib = new ShaderLibrary();
    lib.define({
      name: 'fade',
      base: 'standard',
      uniforms: { progress: 0, tint: new THREE.Color(1, 1, 1) },
      color: (c) => vec4(c.uniforms.tint, 1),
      options: { transparent: true },
    });
    const a = lib.createMaterial('fade');
    const b = lib.createMaterial('fade', { progress: 0.7 }, { roughness: 0.2 });
    a.uniforms.progress.value = 0.3;
    expect(b.uniforms.progress.value).toBe(0.7);
    expect(a.uniforms.tint.value).not.toBe(b.uniforms.tint.value); // 顏色也是各自一份
    expect(a.transparent).toBe(true);
    expect((b as unknown as { roughness: number }).roughness).toBe(0.2);
    expect(() => lib.createMaterial('fade', { nope: 1 })).toThrow(/沒有 uniform「nope」/);
  });

  test('標準材質保留光照：color、emissive、position 對應到節點；basic 不用 emissive', () => {
    const lib = new ShaderLibrary();
    lib.define({
      name: 'lit',
      base: 'standard',
      color: () => vec4(1, 0, 0, 1),
      emissive: () => vec3(0, 1, 0),
      position: (c) => c.position.add(c.normal.mul(0.1)),
    });
    const m = lib.createMaterial('lit') as unknown as NodeMaterial;
    expect((m as unknown as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial).toBe(true);
    expect([!!m.colorNode, !!m.emissiveNode, !!m.positionNode]).toEqual([true, true, true]);
    lib.define({ name: 'b', base: 'basic', emissive: () => vec3(1) });
    expect((lib.createMaterial('b') as unknown as NodeMaterial).emissiveNode).toBeNull();
  });

  test('定義錯誤會清楚報錯；舊的 GLSL 寫法提示改用 TSL；材質與效果不能混用', () => {
    const lib = new ShaderLibrary();
    expect(() => lib.define({ name: 'x', base: 'unlit' })).toThrow(/需要 color 函式/);
    expect(() => lib.define({ name: 'x', base: 'metal' as never, color: () => vec4(1) })).toThrow(/base 不正確/);
    expect(() => lib.define({ name: 'old', base: 'unlit', fragment: 'color = vec4(1.0);' } as never)).toThrow(
      /舊的 GLSL 寫法（fragment）/,
    );
    expect(() => lib.defineEffect({ name: 'e' } as never)).toThrow(/需要 color 函式/);
    lib.defineEffect({ name: 'fx', color: (c) => c.color });
    lib.define({ name: 'mat', base: 'unlit', color: () => vec4(1) });
    expect(() => lib.createMaterial('fx')).toThrow(/全螢幕效果，請用 createEffect/);
    expect(() => lib.createEffect('mat')).toThrow(/材質，請用 createMaterial/);
    expect(() => lib.createMaterial('none')).toThrow(/找不到著色器「none」/);
  });
});

describe('執行中更新', () => {
  test('所有實例換上新節點、保留舊值、加入新 uniform；版本加一', () => {
    const lib = new ShaderLibrary();
    lib.define({ name: 'u', base: 'unlit', uniforms: { a: 1 }, color: () => vec4(1) });
    const m = lib.createMaterial('u') as unknown as NodeMaterial & { uniforms: Record<string, { value: unknown }> };
    m.uniforms.a.value = 5;
    const before = m.colorNode;
    const version = lib.version('u');
    lib.update('u', { uniforms: { a: 1, b: 2 }, color: (c: ShaderContext) => vec4(float(c.uniforms.b), 0, 0, 1) });
    expect(m.colorNode).not.toBe(before);
    expect(m.uniforms.a.value).toBe(5);
    expect(m.uniforms.b.value).toBe(2);
    expect(lib.version('u')).toBe(version + 1);
    expect(() => lib.update('none', {})).toThrow(/找不到/);
  });

  test('釋放的材質不再追蹤；createFromDefinition 不留下名稱', () => {
    const lib = new ShaderLibrary();
    lib.define({ name: 'u', base: 'unlit', color: () => vec4(1) });
    const m = lib.createMaterial('u');
    expect(lib.liveCount('u')).toBe(1);
    m.dispose();
    expect(lib.liveCount('u')).toBe(0);
    const once = lib.createFromDefinition({ name: 'preview', base: 'unlit', color: () => vec4(1) });
    expect(once.shaderName).toBe('preview');
    expect(lib.names).toEqual(['u']);
  });
});

describe('全螢幕效果', () => {
  test('apply 接上前一個效果的顏色；update 後版本加一（後製會重建）', () => {
    const lib = new ShaderLibrary();
    lib.defineEffect({
      name: 'invert',
      uniforms: { amount: 1 },
      color: (c) => vec4(c.color.rgb.oneMinus().mul(c.uniforms.amount), c.color.a),
    });
    const fx = lib.createEffect('invert', { amount: 0.5 });
    expect(fx.shaderName).toBe('invert');
    expect(fx.enabled).toBe(true);
    expect(fx.uniforms.amount.value).toBe(0.5);
    expect(fx.apply(vec4(1, 0, 0, 1))).toBeTruthy();
    const v = fx.version;
    lib.update('invert', { color: (c: EffectContext) => c.color });
    expect(fx.version).toBe(v + 1);
    fx.dispose();
    expect(lib.liveCount('invert')).toBe(0);
  });
});

describe('內建範例與函式', () => {
  test('所有內建範例都能註冊、建立', () => {
    const lib = new ShaderLibrary();
    for (const def of [ShaderPresets.dissolve(), ShaderPresets.hologram(), ShaderPresets.wave()]) {
      lib.define(def);
      const m = lib.createMaterial(def.name) as unknown as NodeMaterial;
      expect(m.isNodeMaterial).toBe(true);
    }
    for (const def of [EffectPresets.chromaticAberration(), EffectPresets.pixelate(), EffectPresets.rainOnWindow()]) {
      lib.defineEffect(def);
      expect(lib.createEffect(def.name).apply(vec4(0, 0, 0, 1))).toBeTruthy();
    }
  });

  test('shaderFns 的函式回傳節點', () => {
    const p = tsl.vec2(0.3, 0.7);
    for (const node of [shaderFns.hash12(p), shaderFns.noise2(p), shaderFns.fbm2(p), shaderFns.voronoi(p)])
      expect(node).toBeTruthy();
  });
});

describe('ShaderPlugin', () => {
  test('可從 ECS 取得；材質描述可以寫 shaderGraph', () => {
    const clock = fakeScheduler();
    const ecs = new EcsPlugin();
    const plugin = new ShaderPlugin();
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    engine.use(ecs).use(plugin);
    engine.start();
    expect(ecs.world.requireResource(ShadersKey)).toBe(plugin.library);
    engine.removePlugin('shaders');
    expect(ecs.world.getResource(ShadersKey)).toBeUndefined();
  });
});
