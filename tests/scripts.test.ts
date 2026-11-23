import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin, type Entity } from '../src/ecs';
import { ScenePlugin, Transform } from '../src/scene';
import { Camera, MeshRenderer, RenderPlugin } from '../src/render';
import { InputPlugin } from '../src/input';
import { Collider, PhysicsPlugin, RigidBody } from '../src/physics';
import { Name, Script, ScriptPlugin, ScriptsKey, type ScriptRunner } from '../src/scripts';
import { fakeScheduler } from './helpers';

const log: string[] = [];

class Recorder extends Script {
  label = 'r';
  onAwake() {
    log.push(`${this.label}:awake`);
  }
  onEnable() {
    log.push(`${this.label}:enable`);
  }
  onStart() {
    log.push(`${this.label}:start`);
  }
  onUpdate() {
    log.push(`${this.label}:update`);
  }
  onFixedUpdate() {
    log.push(`${this.label}:fixed`);
  }
  onLateUpdate() {
    log.push(`${this.label}:late`);
  }
  onDisable() {
    log.push(`${this.label}:disable`);
  }
  onDestroy() {
    log.push(`${this.label}:destroy`);
  }
}

function setup(options: { rethrow?: boolean } = { rethrow: true }) {
  log.length = 0;
  const clock = fakeScheduler();
  const ecs = new EcsPlugin();
  const plugin = new ScriptPlugin(options);
  const engine = new Engine({ scheduler: clock.scheduler, fixedDelta: 0.1, maxDelta: 0.1, pauseOnHidden: false });
  engine.use(ecs).use(new ScenePlugin()).use(plugin);
  engine.start();
  const world = ecs.world;
  const scripts: ScriptRunner = world.requireResource(ScriptsKey);
  const frame = () => clock.frame(100);
  return { world, scripts, frame, engine, clock, ecs };
}

describe('生命週期', () => {
  test('順序：awake → enable →（下一幀）start → fixed → update → late', () => {
    const { world, scripts, frame } = setup();
    const e = world.spawn(Transform);
    scripts.add(e, Recorder);
    expect(log).toEqual(['r:awake', 'r:enable']);
    frame();
    expect(log).toEqual(['r:awake', 'r:enable', 'r:start', 'r:fixed', 'r:update', 'r:late']);
    log.length = 0;
    frame();
    expect(log).toEqual(['r:fixed', 'r:update', 'r:late']); // start 只有一次
  });

  test('props 在 onAwake 之前設定；腳本取得 entity 與 transform', () => {
    const { world, scripts } = setup();
    const e = world.spawn(Transform);
    world.get(e, Transform)!.position.x = 7;
    let seen: unknown[] = [];
    class Probe extends Script {
      speed = 1;
      onAwake() {
        seen = [this.speed, this.entity, this.transform.position.x];
      }
    }
    const s = scripts.add(e, Probe, { speed: 5 });
    expect(seen).toEqual([5, e, 7]);
    expect(scripts.get(e, Probe)).toBe(s);
  });

  test('停用時不更新；停用中加入的腳本，啟用時才 onStart', () => {
    const { world, scripts, frame } = setup();
    const e = world.spawn(Transform);
    const s = scripts.add(e, Recorder, { label: 'a' });
    s.enabled = false;
    frame();
    expect(log).toEqual(['a:awake', 'a:enable', 'a:disable']);
    log.length = 0;
    s.enabled = true;
    frame();
    expect(log).toEqual(['a:enable', 'a:start', 'a:fixed', 'a:update', 'a:late']);
  });

  test('移除腳本、銷毀實體會呼叫 onDisable、onDestroy；onDestroy 時元件還在', () => {
    const { world, scripts, frame } = setup();
    const e = world.spawn(Transform);
    world.get(e, Transform)!.position.y = 3;
    let yAtDestroy = -1;
    class Watcher extends Script {
      onDestroy() {
        yAtDestroy = this.transform.position.y;
      }
    }
    scripts.add(e, Recorder, { label: 'a' });
    scripts.add(e, Watcher);
    const b = scripts.add(e, Recorder, { label: 'b' });
    frame();
    log.length = 0;
    scripts.remove(e, b);
    expect(log).toEqual(['b:disable', 'b:destroy']);
    expect(b.alive).toBe(false);
    world.destroy(e);
    expect(log).toEqual(['b:disable', 'b:destroy', 'a:disable', 'a:destroy']);
    expect(yAtDestroy).toBe(3);
    expect(scripts.count).toBe(0);
  });

  test('executionOrder：數字小的先執行', () => {
    const { world, scripts, frame } = setup();
    class Late extends Recorder {
      static executionOrder = 10;
    }
    class Early extends Recorder {
      static executionOrder = -10;
    }
    const e = world.spawn(Transform);
    scripts.add(e, Late, { label: 'late' });
    scripts.add(e, Recorder, { label: 'mid' });
    scripts.add(world.spawn(Transform), Early, { label: 'early' });
    frame();
    expect(log.filter((l) => l.endsWith(':update'))).toEqual(['early:update', 'mid:update', 'late:update']);
  });
});

describe('錯誤隔離', () => {
  test('一個腳本出錯不影響其他腳本，並記錄是哪個腳本', () => {
    const { world, scripts, frame } = setup({});
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((msg: string) => errors.push(msg));
    class Broken extends Script {
      onUpdate() {
        throw new Error('boom');
      }
    }
    scripts.add(world.spawn(Transform), Broken);
    scripts.add(world.spawn(Transform), Recorder);
    frame();
    spy.mockRestore();
    expect(log).toContain('r:update');
    expect(errors[0]).toMatch(/Broken.*onUpdate/);
  });
});

describe('等待（遊戲時間）', () => {
  test('wait、nextFrame、waitUntil；受時間縮放影響', async () => {
    const { world, scripts, frame, engine } = setup();
    const steps: string[] = [];
    let flag = false;
    class Seq extends Script {
      async onStart() {
        await this.wait(0.25);
        steps.push('waited');
        await this.nextFrame();
        steps.push('next');
        await this.waitUntil(() => flag);
        steps.push('until');
      }
    }
    scripts.add(world.spawn(Transform), Seq);
    frame(); // start（等待從下一幀開始計時）
    frame(); // 0.1
    frame(); // 0.2
    await Promise.resolve();
    expect(steps).toEqual([]);
    frame(); // 0.3 ≥ 0.25
    await Promise.resolve();
    expect(steps).toEqual(['waited']);
    frame();
    await Promise.resolve();
    expect(steps).toEqual(['waited', 'next']);
    engine.time.timeScale = 0; // 暫停遊戲時間：waitUntil 不受影響
    flag = true;
    frame();
    await Promise.resolve();
    expect(steps).toEqual(['waited', 'next', 'until']);
  });

  test('腳本被銷毀後，await 之後的程式碼不會執行', async () => {
    const { world, scripts, frame } = setup();
    let ran = false;
    class Delayed extends Script {
      async onStart() {
        await this.wait(0.2);
        ran = true;
      }
    }
    const e = world.spawn(Transform);
    scripts.add(e, Delayed);
    frame();
    world.destroy(e);
    for (let i = 0; i < 5; i++) frame();
    await Promise.resolve();
    expect(ran).toBe(false);
  });
});

describe('腳本之間的溝通', () => {
  test('sendMessage、getScript、find、destroy', () => {
    const { world, scripts, frame } = setup();
    class Health extends Script {
      hp = 10;
      takeDamage(n: number) {
        this.hp -= n;
        if (this.hp <= 0) this.destroy();
      }
    }
    class Attacker extends Script {
      target!: Entity;
      onUpdate() {
        this.sendMessage(this.target, 'takeDamage', 4);
        this.sendMessage(this.target, 'noSuchMethod'); // 沒有的方法會略過
      }
    }
    const enemy = world.spawn(Transform, Name.with({ value: 'Enemy' }));
    const health = scripts.add(enemy, Health);
    const player = world.spawn(Transform);
    const attacker = scripts.add(player, Attacker, { target: enemy });
    expect(attacker.find('Enemy')).toBe(enemy);
    expect(attacker.getScript(Health, enemy)).toBe(health);
    frame();
    expect(health.hp).toBe(6);
    frame();
    frame();
    expect(world.isAlive(enemy)).toBe(false); // 第三下 hp 歸零，銷毀
  });
});

describe('物理事件', () => {
  test('碰撞與觸發區的 enter／exit', async () => {
    const { world, scripts, engine, clock } = setup();
    engine.use(await PhysicsPlugin.create({ interpolate: false }));
    const events: string[] = [];
    class Ball extends Script {
      onCollisionEnter(other: Entity) {
        events.push(`hit:${world.get(other, Name)?.value}`);
      }
      onTriggerEnter(other: Entity) {
        events.push(`enter:${world.get(other, Name)?.value}`);
      }
      onTriggerExit(other: Entity) {
        events.push(`exit:${world.get(other, Name)?.value}`);
      }
    }
    const floor = world.spawn(Name.with({ value: 'floor' }), Collider.with({ halfExtents: { x: 10, y: 0.5, z: 10 } }));
    world.add(floor, Transform).position.y = -0.5;
    const zone = world.spawn(
      Name.with({ value: 'zone' }),
      Collider.with({ sensor: true, halfExtents: { x: 1, y: 0.5, z: 1 } }),
    );
    world.add(zone, Transform).position.y = 2;
    const ball = world.spawn(RigidBody.with({}), Collider.with({ shape: 'sphere', radius: 0.25 }));
    world.add(ball, Transform).position.y = 4;
    scripts.add(ball, Ball);
    for (let i = 0; i < 30; i++) clock.frame(100);
    expect(events).toEqual(['enter:zone', 'exit:zone', 'hit:floor']);
  });
});

describe('點擊與滑鼠移入移出', () => {
  test('點到網格時呼叫該實體腳本的 onClick；移入移出', () => {
    const { world, scripts, engine, clock } = setup();
    const fakeRenderer = {
      domElement: { parentElement: null, remove() {} },
      shadowMap: {},
      setPixelRatio() {},
      setSize() {},
      clear() {},
      dispose() {},
      render(scene: THREE.Scene) {
        scene.updateMatrixWorld();
      },
    } as unknown as import('three/webgpu').WebGPURenderer;
    engine.use(new RenderPlugin({ renderer: fakeRenderer, size: { width: 100, height: 100 } }));
    const input = new InputPlugin({ getGamepads: () => [] });
    engine.use(input);
    world.spawn(Transform, Camera).valueOf();
    world.get(world.query([Camera]).first()!, Transform)!.position.z = 5;
    const box = world.spawn(
      Transform,
      MeshRenderer.with({ geometry: new THREE.BoxGeometry(), material: new THREE.MeshBasicMaterial() }),
    );
    const events: string[] = [];
    class Clickable extends Script {
      onClick() {
        events.push('click');
      }
      onPointerEnter() {
        events.push('enter');
      }
      onPointerExit() {
        events.push('exit');
      }
    }
    scripts.add(box, Clickable);
    clock.frame(100); // 繪製一次，矩陣就緒

    input.input.pointerMove(50, 50, 100, 100); // 畫面中央
    clock.frame(100);
    input.input.pointerDown(1, 0, 50, 50);
    clock.frame(100);
    input.input.pointerUp(1, 0);
    input.input.pointerMove(1, 1, 100, 100); // 角落：移出
    clock.frame(100);
    expect(events).toEqual(['enter', 'click', 'exit']);
  });
});
