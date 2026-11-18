import { describe, expect, test, vi } from 'vitest';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import {
  ScenePlugin,
  SceneCodecsKey,
  Transform,
  parseSceneFile,
  spawnSceneFile,
  stringifySceneXml,
} from '../src/scene';
import { Script, ScriptList, ScriptPlugin, scriptListCodec } from '../src/scripts';
import { fakeScheduler } from './helpers';

class Spinner extends Script {
  speed = 90;
  label = 'a';
  started = 0;
  /** onStart 時其他元件（Transform）已經加好 */
  hadTransform = false;
  onStart() {
    this.started++;
    this.hadTransform = this.world.has(this.entity, Transform);
  }
}
class Bonus extends Script {
  value = 1;
}

function setup() {
  const clock = fakeScheduler();
  const ecs = new EcsPlugin();
  const scripts = new ScriptPlugin({ rethrow: true });
  const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
  engine.use(ecs).use(new ScenePlugin()).use(scripts);
  engine.start();
  scripts.runner.register({ Spinner, Bonus });
  return { clock, world: ecs.world, runner: scripts.runner };
}

const XML = `<Scene version="1">
  <Entity id="a">
    <Transform position="1 0 0"/>
    <ScriptList>
      <Spinner speed="180"/>
      <Bonus/>
    </ScriptList>
  </Entity>
</Scene>`;

describe('場景檔裡的腳本（ScriptList）', () => {
  test('載入場景檔就掛上登記的腳本，參數覆蓋預設值', () => {
    const { clock, world, runner } = setup();
    const spawned = spawnSceneFile(world, parseSceneFile(XML));
    const a = spawned.entities.get('a')!;
    clock.frame(16);
    const spin = runner.get(a, Spinner)!;
    expect(spin.speed).toBe(180);
    expect(spin.label).toBe('a');
    expect(spin.started).toBe(1);
    expect(spin.hadTransform).toBe(true);
    expect(runner.get(a, Bonus)!.value).toBe(1);
    // 移除 ScriptList：由它掛上的腳本一起移除
    world.remove(a, ScriptList);
    clock.frame(16);
    expect(runner.getAll(a)).toHaveLength(0);
  });

  test('沒有登記的腳本：警告、略過，其他照常掛', () => {
    const { clock, world, runner } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const file = parseSceneFile(XML.replace('<Bonus/>', '<Missing/>'));
    const a = spawnSceneFile(world, file).entities.get('a')!;
    clock.frame(16);
    expect(runner.getAll(a).map((s) => s.constructor.name)).toEqual(['Spinner']);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/Missing.*register/);
    warn.mockRestore();
  });

  test('存讀：XML 寫成 <ScriptList><名稱 參數/></ScriptList>；名稱不合法時丟出錯誤', () => {
    const { world } = setup();
    expect(world.requireResource(SceneCodecsKey).get('ScriptList')).toBeDefined();
    const ctx = { entity: 'a', component: 'ScriptList', warn() {} };
    expect(scriptListCodec.read({ Coin: { value: 2 } }, ctx)).toEqual({ scripts: { Coin: { value: 2 } } });
    expect(() => scriptListCodec.read({ '1bad': {} }, ctx)).toThrow(/不合法/);
    const out = stringifySceneXml({
      format: 'hero-scene',
      version: 1,
      entities: [{ id: 'c', components: { ScriptList: scriptListCodec.write({ scripts: { Coin: { value: 2 } } }) } }],
    });
    expect(out).toMatch(/<ScriptList>\s*<Coin value="2"\/>\s*<\/ScriptList>/);
  });
});

describe('spawned.add：依場景檔 id 加上元件', () => {
  test('找得到：加上並回傳實體；找不到：警告、略過、回傳 undefined', () => {
    const { world } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spawned = spawnSceneFile(world, parseSceneFile(XML));
    const a = spawned.add('a', Transform);
    expect(a).toBe(spawned.entities.get('a'));
    expect(spawned.add('nope', Transform)).toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/nope/);
    warn.mockRestore();
  });
});
