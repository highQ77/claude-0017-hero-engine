import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin, World } from '../src/ecs';
import { ScenePlugin, Transform } from '../src/scene';
import { RenderPlugin, SceneObject } from '../src/render';
import {
  AnimationPlugin,
  AnimationStateMachine,
  Animator,
  Easing,
  Timeline,
  TweenManager,
  play,
  type AnimationStateMachineDef,
} from '../src/animation';
import { fakeScheduler } from './helpers';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 5);

describe('緩動曲線', () => {
  test('起點 0、終點 1', () => {
    for (const [name, fn] of Object.entries(Easing)) {
      expect(fn(0), name).toBeCloseTo(0, 5);
      expect(fn(1), name).toBeCloseTo(1, 5);
    }
    close(Easing.quadIn(0.5), 0.25);
  });
});

describe('補間', () => {
  test('基本補間、完成回呼、finished 為 true', async () => {
    const m = new TweenManager();
    const pos = new THREE.Vector3();
    const done = vi.fn();
    const t = m.to(pos, { x: 10 }, { duration: 1, easing: 'linear', onComplete: done });
    m.update(0.25);
    close(pos.x, 2.5);
    m.update(1);
    expect(pos.x).toBe(10);
    expect(done).toHaveBeenCalledOnce();
    expect(m.count).toBe(0);
    await expect(t.finished).resolves.toBe(true);
  });

  test('延遲期間不碰目標；停止時 finished 為 false', async () => {
    const m = new TweenManager();
    const o = { v: 0 };
    const t = m.to(o, { v: 1 }, { duration: 1, delay: 1, easing: 'linear' });
    o.v = 5; // 延遲期間外部修改
    m.update(0.5);
    expect(o.v).toBe(5);
    m.update(1); // 從 5 開始補間
    close(o.v, 5 + (1 - 5) * 0.5);
    t.stop();
    await expect(t.finished).resolves.toBe(false);
  });

  test('來回重複（yoyo）與跳到結尾', () => {
    const m = new TweenManager();
    const o = { v: 0 };
    m.to(o, { v: 10 }, { duration: 1, easing: 'linear', repeat: 1, yoyo: true });
    m.update(1.25); // 第二輪倒播 0.25
    close(o.v, 7.5);
    m.update(5);
    expect(o.v).toBe(0);
    expect(m.count).toBe(0);

    const p = { v: 0 };
    const t = m.to(p, { v: 4 }, { duration: 1, repeat: Infinity });
    m.update(0.1);
    t.stop(true);
    expect(p.v).toBe(4);
  });

  test('實體銷毀時自動停止、killTweensOf、不受時間縮放', () => {
    const w = new World();
    const m = new TweenManager(w);
    const e = w.create();
    const a = { v: 0 },
      b = { v: 0 },
      c = { v: 0 };
    m.to(a, { v: 1 }, { duration: 1, entity: e });
    m.to(b, { v: 1 }, { duration: 1 });
    m.to(c, { v: 10 }, { duration: 1, easing: 'linear', unscaled: true });
    w.destroy(e);
    m.killTweensOf(b);
    m.update(0, 0.5); // 遊戲時間暫停（縮放 0），真實時間 0.5 秒
    expect([a.v, b.v]).toEqual([0, 0]);
    close(c.v, 5);
    expect(m.count).toBe(1);
  });

  test('不是數字的屬性報錯', () => {
    const m = new TweenManager();
    expect(() => m.to({ name: 'x' } as Record<string, unknown>, { name: 'y' } as never, { duration: 1 })).toThrow(
      /不是數字/,
    );
  });
});

describe('時間軸', () => {
  test('同一屬性的連續步驟、同時開始、呼叫順序', () => {
    const m = new TweenManager();
    const s = { x: 1 };
    const o = { a: 0 };
    const log: string[] = [];
    const tl = new Timeline()
      .to(s, { x: 2 }, { duration: 1, easing: 'linear' })
      .to(o, { a: 1 }, { duration: 1, easing: 'linear', at: '<' })
      .call(() => log.push('mid'))
      .to(s, { x: 0 }, { duration: 1, easing: 'linear' })
      .wait(0.5)
      .call(() => log.push('end'));
    expect(tl.duration).toBe(2.5);
    m.play(tl);
    m.update(0.5);
    close(s.x, 1.5);
    close(o.a, 0.5);
    expect(log).toEqual([]);
    m.update(1); // t = 1.5：第二段走了一半，起點接續第一段的終點 2
    close(s.x, 1);
    expect(log).toEqual(['mid']);
    m.update(5);
    expect(s.x).toBe(0);
    expect(log).toEqual(['mid', 'end']);
  });

  test('一次跳過多段也會得到正確數值；重複時回到初始值', () => {
    const m = new TweenManager();
    const s = { x: 0 };
    const tl = new Timeline()
      .to(s, { x: 10 }, { duration: 1, easing: 'linear' })
      .to(s, { x: 20 }, { duration: 1, easing: 'linear' });
    m.play(tl, { repeat: 1 });
    m.update(1.5); // 直接跳進第二段
    close(s.x, 15);
    m.update(0.75); // 進入第二輪 0.25
    close(s.x, 2.5);
  });

  test('fromTo 與 delay 等待', async () => {
    const m = new TweenManager();
    const o = { v: 100 };
    m.fromTo(o, { v: 0 }, { v: 1 }, { duration: 1, easing: 'linear' });
    m.update(0.5);
    close(o.v, 0.5);
    let waited = false;
    m.delay(1).finished.then(() => (waited = true));
    m.update(0.6);
    await Promise.resolve();
    expect(waited).toBe(false);
    m.update(0.5);
    await Promise.resolve();
    expect(waited).toBe(true);
  });
});

// ───────── Animator 與狀態機 ─────────

/** 建立一個有子節點 'box' 的模型，以及兩個片段 */
function makeRig() {
  const root = new THREE.Group();
  const box = new THREE.Object3D();
  box.name = 'box';
  root.add(box);
  const track = (name: string, to: number, duration = 1) =>
    new THREE.AnimationClip(name, duration, [new THREE.NumberKeyframeTrack('box.position[x]', [0, duration], [0, to])]);
  return { root, box, clips: [track('walk', 10), track('jump', -10, 0.5)] };
}

function setupEngine() {
  const clock = fakeScheduler();
  const ecs = new EcsPlugin();
  const fakeRenderer = {
    domElement: { parentElement: null, remove() {} },
    shadowMap: {},
    setPixelRatio() {},
    setSize() {},
    render() {},
    clear() {},
    dispose() {},
  } as unknown as import('three/webgpu').WebGPURenderer;
  const anim = new AnimationPlugin();
  const engine = new Engine({ scheduler: clock.scheduler, fixedDelta: 0.1, maxDelta: 1, pauseOnHidden: false });
  engine
    .use(ecs)
    .use(new ScenePlugin())
    .use(new RenderPlugin({ renderer: fakeRenderer, size: { width: 10, height: 10 } }))
    .use(anim);
  engine.start();
  return { clock, world: ecs.world, anim };
}

describe('Animator', () => {
  test('播放、交叉淡入淡出、播放速度、暫停', () => {
    const { clock, world, anim } = setupEngine();
    const { root, box, clips } = makeRig();
    const e = world.spawn(
      Transform,
      SceneObject.with({ object: root }),
      Animator.with({ clips, play: 'walk', fade: 0.5 }),
    );
    clock.frame(250);
    const a = world.get(e, Animator)!;
    expect(a.current).toBe('walk');
    close(a.time, 0.25);
    close(box.position.x, 2.5);

    play.animation(a, 'jump');
    clock.frame(250); // 淡入淡出中：兩個動作都有權重
    const mixer = anim.animators.mixerOf(e)!;
    const walk = mixer.existingAction(clips[0])!;
    const jump = mixer.existingAction(clips[1])!;
    expect(walk.getEffectiveWeight()).toBeGreaterThan(0);
    expect(jump.getEffectiveWeight()).toBeGreaterThan(0);
    clock.frame(500);
    expect(walk.getEffectiveWeight()).toBe(0);
    expect(a.current).toBe('jump');

    a.speed = 2;
    const before = a.time;
    clock.frame(100);
    close(a.time - before, 0.2);
    a.paused = true;
    clock.frame(100);
    close(a.time - before, 0.2);
  });

  test('不循環片段播完會停在最後一格並標記 finished；restart 從頭播', () => {
    const { clock, world } = setupEngine();
    const { root, box, clips } = makeRig();
    const e = world.spawn(Transform, SceneObject.with({ object: root }), Animator.with({ clips, fade: 0 }));
    const a = world.get(e, Animator)!;
    play.animation(a, 'jump', { loop: false });
    clock.frame(300);
    expect(a.finished).toBe(false);
    clock.frame(300);
    expect(a.finished).toBe(true);
    close(box.position.x, -10);
    play.animation(a, 'jump', { restart: true });
    clock.frame(100);
    expect(a.finished).toBe(false);
    close(a.time, 0.1);
  });

  test('找不到片段會警告一次；根物件晚到也能開始；移除元件會清理', () => {
    const { clock, world, anim } = setupEngine();
    const { root, clips } = makeRig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const e = world.spawn(Transform, Animator.with({ clips, play: 'nope' }));
    clock.frame(16);
    expect(world.get(e, Animator)!.current).toBeNull(); // 還沒有根物件
    world.add(e, SceneObject, { object: root });
    clock.frame(16);
    clock.frame(16);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();

    play.animation(world.get(e, Animator)!, 'walk');
    clock.frame(16);
    expect(world.get(e, Animator)!.current).toBe('walk');
    world.remove(e, Animator);
    expect(anim.animators.mixerOf(e)).toBeUndefined();
  });
});

describe('動畫狀態機', () => {
  const def: AnimationStateMachineDef = {
    initial: 'walk',
    states: { walk: { clip: 'walk' }, jump: { clip: 'jump', loop: false }, idle: { clip: 'walk', speed: 0 } },
    transitions: [
      { from: '*', to: 'jump', trigger: 'jump', fade: 0 },
      { from: 'jump', to: 'walk', onFinish: true },
      { from: 'walk', to: 'idle', when: (p) => p.tired === true },
    ],
  };

  test('初始狀態、觸發器、播完自動返回、條件轉換', () => {
    const { clock, world } = setupEngine();
    const { root, clips } = makeRig();
    const e = world.spawn(
      Transform,
      SceneObject.with({ object: root }),
      Animator.with({ clips }),
      AnimationStateMachine.with({ definition: def }),
    );
    const sm = world.get(e, AnimationStateMachine)!;
    const a = world.get(e, Animator)!;
    clock.frame(100);
    expect([sm.state, a.current]).toEqual(['walk', 'walk']);

    play.trigger(sm, 'jump');
    clock.frame(100);
    expect([sm.state, sm.previous, a.current, a.loop]).toEqual(['jump', 'walk', 'jump', false]);
    expect(sm.triggers.size).toBe(0);

    clock.frame(300);
    expect(sm.state).toBe('jump');
    clock.frame(300); // 片段播完
    clock.frame(16); // 狀態機下一幀看到 finished
    expect(sm.state).toBe('walk');

    sm.params.tired = true;
    clock.frame(16);
    expect([sm.state, a.speed]).toEqual(['idle', 0]);
  });

  test('定義錯誤時提早報錯', () => {
    const { clock, world } = setupEngine();
    world.spawn(
      Animator,
      AnimationStateMachine.with({
        definition: { initial: 'a', states: { a: { clip: 'x' } }, transitions: [{ from: 'a', to: 'missing' }] },
      }),
    );
    expect(() => clock.frame(16)).toThrow(/目標狀態「missing」不存在/);
  });
});
