import { afterEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { parseSceneFile, stringifySceneXml } from '../src/scene';
import { meshRendererCodec } from '../src/render';
import { createMaterial } from '../src/render/descriptors';
import { ShaderPlugin } from '../src/shaders';
import { stringifyShaderGraphFile } from '../src/shaders/graph';
import { buildExample } from '../src/editors/shader-editor/examples';
import { fakeScheduler } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('材質描述 { shaderGraph }', () => {
  test('沒有安裝 ShaderPlugin：清楚的錯誤', () => {
    expect(() => createMaterial({ shaderGraph: 'shaders/a.shader.json' })).toThrow(/ShaderPlugin/);
  });

  test('安裝後：先建立不顯示的材質，節點圖載入後填入著色器；取消安裝後不能再用', async () => {
    const text = stringifyShaderGraphFile({ format: 'hero-shader-graph', version: 1, graph: buildExample('lava') });
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url);
      return new Response(text);
    });
    const ecs = new EcsPlugin();
    const plugin = new ShaderPlugin();
    const engine = new Engine({ scheduler: fakeScheduler().scheduler, pauseOnHidden: false });
    engine.use(ecs).use(plugin);
    const m = createMaterial({ shaderGraph: 'shaders/lava.shader.json' }) as THREE.ShaderMaterial;
    expect(m).toBeInstanceOf(THREE.ShaderMaterial);
    expect(m.visible).toBe(false);
    await flush();
    await flush();
    expect(fetched).toEqual(['shaders/lava.shader.json']);
    expect(m.visible).toBe(true);
    expect(m.fragmentShader).toContain('sgObjPos'); // 熔岩用物件座標
    expect(m.vertexShader).toContain('transformed += normal');
    expect(m.uniforms.uTime).toBe(plugin.library.builtins.uTime); // 和引擎共用時間
    engine.removePlugin('shaders');
    expect(() => createMaterial({ shaderGraph: 'shaders/lava.shader.json' })).toThrow(/ShaderPlugin/);
  });

  test('場景檔：XML 寫成 <material shaderGraph="…"/>，存讀一樣', () => {
    const data = meshRendererCodec.write({
      ...meshRendererCodec.read(
        { geometry: { sphere: 0.5 }, material: { shaderGraph: 'shaders/lava.shader.json' } },
        {
          entity: 'a',
          component: 'MeshRenderer',
          warn() {},
        },
      ),
    } as never);
    const xml = stringifySceneXml({
      format: 'hero-scene',
      version: 1,
      entities: [{ id: 'm', components: { MeshRenderer: data } }],
    });
    expect(xml).toContain('shaderGraph="shaders/lava.shader.json"');
    const back = parseSceneFile(xml).entities[0].components!.MeshRenderer as { material: unknown };
    expect(back.material).toEqual({ shaderGraph: 'shaders/lava.shader.json' });
  });
});
