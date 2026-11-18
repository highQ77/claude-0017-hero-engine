/**
 * 打包時只包含用到的部分：用 esbuild 打包幾個最小的遊戲，檢查留在結果裡的引擎檔案。
 * 依賴 package.json 的 sideEffects（src/ 沒有引用時就執行的程式）與各模組的 keys.ts。
 * 這個測試失敗代表某個改動讓不相干的模組被一起打包了（例如在模組最上層呼叫了會改動外部狀態的函式）。
 */
import { build } from 'esbuild';
import { describe, expect, test } from 'vitest';

/** 專案根目錄（結尾有 /） */
const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname);

/** 打包一段程式，回傳留在結果裡的引擎檔案（src/ 底下，去掉 .ts） */
async function bundledFiles(code: string): Promise<string[]> {
  const result = await build({
    stdin: { contents: code, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    metafile: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    tsconfig: `${ROOT}tsconfig.json`,
    external: ['three', 'three/*', '@dimforge/*', 'yoga-layout*', 'lil-gui'],
    logLevel: 'silent',
  });
  const output = Object.values(result.metafile.outputs)[0];
  return Object.entries(output.inputs)
    .filter(([path, info]) => path.startsWith('src/') && info.bytesInOutput > 0)
    .map(([path]) => path.slice(4).replace(/\.ts$/, ''))
    .sort();
}

/** 檔案屬於哪些模組 */
const modulesOf = (files: string[]) => [...new Set(files.map((f) => f.split('/')[0]))].sort();

/** 各模組都會用到的小檔案（不算「整個模組」）：記錄器 */
const SHARED_SMALL = ['core/Logger'];
/** 只有資源鍵（keys.ts、ecs/Resource）與共用小檔案的模組不算「整個模組」 */
const fullModulesOf = (files: string[]) =>
  modulesOf(files.filter((f) => !f.endsWith('/keys') && f !== 'ecs/Resource' && !SHARED_SMALL.includes(f)));

describe('打包時只包含用到的部分', () => {
  test('只做 3D 繪製：core、ecs、scene、render', async () => {
    const files = await bundledFiles(`
      import { Engine } from '@engine/core';
      import { EcsPlugin } from '@engine/ecs';
      import { ScenePlugin } from '@engine/scene';
      import { RenderPlugin, spawn } from '@engine/render';
      const ecs = new EcsPlugin();
      new Engine().use(ecs).use(new ScenePlugin()).use(new RenderPlugin());
      spawn.camera(ecs.world);
    `);
    expect(fullModulesOf(files)).toEqual(['core', 'ecs', 'render', 'scene']);
  });

  test('總入口 import * as hero：也只包含用到的部分', async () => {
    const files = await bundledFiles(`
      import * as hero from '@engine';
      console.log(hero.Engine, hero.spawn.camera);
    `);
    expect(fullModulesOf(files)).toEqual(['core', 'ecs', 'render', 'scene']);
  });

  test('總入口的合併分類（hero.create）：只包含那個分類，其他分類不會被帶進來', async () => {
    const files = await bundledFiles(`
      import * as hero from '@engine';
      console.log(hero.create.geometry);
    `);
    // create 分類的成員分散在 core、render、animation、particles、postfx、text3d；ui2d、plugins 等其他分類的模組不應該出現
    for (const m of ['ui2d', 'plugins', 'physics', 'audio', 'ai', 'scripts']) expect(modulesOf(files)).not.toContain(m);
    // text3d 只帶進 create 分類的小檔案（不包含 3D 文字元件、字型載入）
    expect(files.filter((f) => f.startsWith('text3d/'))).toEqual(['text3d/create']);
  });

  test('腳本：其他模組只包含資源鍵（keys.ts），不包含整個模組', async () => {
    const files = await bundledFiles(`
      import { ScriptPlugin, Script } from '@engine/scripts';
      class Hello extends Script { onUpdate() {} }
      console.log(ScriptPlugin, Hello);
    `);
    expect(fullModulesOf(files)).toEqual(['ecs', 'scene', 'scripts']);
    // 腳本的 this.physics、this.audio…：只需要這些模組的資源鍵
    for (const m of ['physics', 'audio', 'input', 'animation', 'assets', 'render'])
      expect(files).toContain(`${m}/keys`);
  });

  test('純函式（steer.seek）：只有 ai 的轉向函式', async () => {
    const files = await bundledFiles(`
      import { steer } from '@engine/ai';
      console.log(steer.seek);
    `);
    expect(files).toEqual(['ai/index', 'ai/steering']); // index 只有 steer 這個分類物件
  });

  test('套件管理：不會連帶包含整個引擎（模組由遊戲用 api 選項提供）', async () => {
    const files = await bundledFiles(`
      import { PluginManager } from '@engine/plugins';
      console.log(PluginManager);
    `);
    // 其他模組只有資源鍵與註冊用的小檔案
    const outside = files.filter((f) => !f.startsWith('plugins/'));
    expect(outside).toEqual(
      [
        'assets/keys',
        'core/Logger',
        'core/version',
        'ecs/Resource',
        'shaders/chunks',
        'shaders/keys',
        'ui2d/registry',
      ].sort(),
    );
  });
});
