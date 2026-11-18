import { describe, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { Engine } from '../src/core';
import { EcsPlugin } from '../src/ecs';
import { ScenePlugin, Transform, math } from '../src/scene';
import { AssetManager, AssetPlugin, type AssetLoader } from '../src/assets';
import { AudioListener, AudioManager, AudioPlugin, AudioSource, play } from '../src/audio';
import { FakeContext, type FakeGain, FakePanner, fakeBuffer } from './fakeAudio';
import { fakeScheduler } from './helpers';

const tick = () => new Promise((r) => setTimeout(r, 0));

/** 可控制完成時機的音效載入器 */
function audioLoader() {
  const pending = new Map<string, { resolve: (b: AudioBuffer) => void; reject: (e: Error) => void }>();
  let calls = 0;
  const loader: AssetLoader<AudioBuffer> = {
    extensions: ['.ogg'],
    load(url) {
      calls++;
      return new Promise((resolve, reject) => pending.set(url, { resolve, reject }));
    },
  };
  return {
    loader,
    get calls() {
      return calls;
    },
    resolve: (url: string) => {
      pending.get(url)!.resolve(fakeBuffer(url));
      pending.delete(url);
    },
    reject: (url: string) => {
      pending.get(url)!.reject(new Error('404'));
      pending.delete(url);
    },
  };
}

function setupManager(options: { groups?: string[]; maxVoices?: number } = {}) {
  const ctx = new FakeContext();
  const assets = new AssetManager();
  const fake = audioLoader();
  assets.registerLoader('audio', fake.loader);
  const audio = new AudioManager(assets, { context: ctx as unknown as AudioContext, ...options });
  return { ctx, assets, fake, audio };
}

describe('AudioManager', () => {
  test('音量群組的連線：聲音 → 聲音音量 → 群組 → 總音量 → 輸出', () => {
    const { ctx, audio } = setupManager();
    audio.play(fakeBuffer(), { group: 'ui', volume: 0.5 });
    const source = ctx.last;
    const voiceGain = [...source.outputs][0] as FakeGain;
    const groupGain = [...voiceGain.outputs][0] as FakeGain;
    const masterGain = [...groupGain.outputs][0] as FakeGain;
    expect(voiceGain.gain.value).toBe(0.5);
    expect([...masterGain.outputs][0]).toBe(ctx.destination);
    expect(source.startedAt).toBe(0);

    audio.setVolume('ui', 0.3);
    expect(groupGain.gain.value).toBe(0.3);
    audio.setMuted('ui', true);
    expect(groupGain.gain.value).toBe(0);
    expect(audio.getVolume('ui')).toBe(0.3); // 靜音不改記錄的音量
    audio.setMuted('ui', false);
    expect(groupGain.gain.value).toBe(0.3);
    audio.setVolume('master', 0.8, 1);
    expect(masterGain.gain.events.at(-1)).toBe('ramp 0.8@1');
    expect(() => audio.play(fakeBuffer(), { group: 'nope' })).toThrow(/未知的音量群組/);
  });

  test('用網址播放：第一次載入後常駐，之後立即播放；同時多次只載入一次', async () => {
    const { ctx, fake, audio, assets } = setupManager();
    const a = audio.play('jump.ogg');
    const b = audio.play('jump.ogg');
    expect([a.state, b.state]).toEqual(['loading', 'loading']);
    await tick();
    fake.resolve('jump.ogg');
    await tick();
    expect([a.state, b.state]).toEqual(['playing', 'playing']);
    expect(fake.calls).toBe(1);

    const c = audio.play('jump.ogg');
    expect(c.state).toBe('playing'); // 已常駐 → 同步開始
    expect(assets.refCount('jump.ogg', 'audio')).toBe(1);
    audio.unload('jump.ogg');
    expect(assets.refCount('jump.ogg', 'audio')).toBe(0);
    expect(ctx.sources).toHaveLength(3);
  });

  test('播完、停止（含淡出）、載入中就停止、載入失敗', async () => {
    const { ctx, fake, audio } = setupManager();
    const s = audio.play(fakeBuffer());
    ctx.last.end();
    expect(s.state).toBe('ended');
    expect(audio.activeCount).toBe(0);
    await expect(s.ended).resolves.toBeUndefined();

    ctx.currentTime = 10;
    const f = audio.play(fakeBuffer(), { volume: 0.6 });
    const src = ctx.last;
    f.stop(2);
    expect(f.state).toBe('stopping');
    expect(src.stopAt).toBe(12);
    const gain = [...src.outputs][0] as FakeGain;
    expect(gain.gain.events.slice(-2)).toEqual(['set 0.6@10', 'ramp 0@12']);
    src.end();
    expect(f.state).toBe('stopped');
    expect(gain.disconnected).toBe(true);

    const early = audio.play('later.ogg');
    early.stop();
    await tick();
    fake.resolve('later.ogg');
    await tick();
    expect(early.state).toBe('stopped');
    expect(ctx.sources).toHaveLength(2); // 沒有真的開始播放

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = audio.play('bad.ogg');
    await tick();
    fake.reject('bad.ogg');
    await tick();
    errorSpy.mockRestore();
    expect(bad.state).toBe('error');
  });

  test('音高、隨機音高、循環、淡入、起始位置', () => {
    const { ctx, audio } = setupManager();
    vi.spyOn(Math, 'random').mockReturnValue(1); // 隨機值取最大
    audio.play(fakeBuffer(), { pitch: 2, randomPitch: 0.1, loop: true, fadeIn: 0.5, offset: 3, volume: 0.7 });
    vi.restoreAllMocks();
    const src = ctx.last;
    expect(src.playbackRate.value).toBeCloseTo(2.2);
    expect(src.loop).toBe(true);
    expect(src.offset).toBe(3);
    const gain = [...src.outputs][0] as FakeGain;
    expect(gain.gain.events.at(-1)).toBe('ramp 0.7@0.5');
  });

  test('同時發聲上限：停止最舊的', () => {
    const { audio } = setupManager({ maxVoices: 2 });
    const a = audio.play(fakeBuffer());
    audio.play(fakeBuffer());
    audio.play(fakeBuffer());
    expect(a.state).toBe('stopping');
    expect(audio.activeCount).toBe(2);
  });

  test('3D 音效：聲音位置與聽者朝向', () => {
    const { ctx, audio } = setupManager();
    audio.play(fakeBuffer(), { spatial: { refDistance: 2, rolloff: 0.5 }, position: { x: 1, y: 2, z: 3 } });
    const panner = [...([...ctx.last.outputs][0] as FakeGain).outputs][0] as FakePanner;
    expect(panner).toBeInstanceOf(FakePanner);
    expect([panner.panningModel, panner.refDistance, panner.rolloffFactor]).toEqual(['HRTF', 2, 0.5]);
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([1, 2, 3]);

    // 聽者在 (0,0,5) 看向原點：前方是 -Z
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 5), new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    m.setPosition(0, 0, 5);
    audio.setListenerMatrix(m);
    const l = ctx.listener;
    expect([l.positionZ.value, l.forwardZ.value, l.upY.value]).toEqual([5, -1, 1]);
  });
});

describe('音樂', () => {
  test('交叉淡入淡出、同一首不重播、停止', async () => {
    const { ctx, fake, audio } = setupManager();
    const a = audio.playMusic('a.ogg', { fade: 2 });
    await tick();
    fake.resolve('a.ogg');
    await tick();
    expect(audio.currentMusic).toBe('a.ogg');
    expect(ctx.last.loop).toBe(true);
    expect(audio.playMusic('a.ogg')).toBe(a);

    const b = audio.playMusic('b.ogg', { fade: 2 });
    expect(a.state).toBe('stopping');
    expect(audio.currentMusic).toBe('b.ogg');
    audio.stopMusic(0);
    expect(b.state).toBe('stopped'); // 還在載入中就被停止
    expect(audio.currentMusic).toBeNull();
  });
});

describe('AudioPlugin 與 AudioSource', () => {
  function setup() {
    const clock = fakeScheduler();
    const ctx = new FakeContext();
    const fake = audioLoader();
    const ecs = new EcsPlugin();
    const assets = new AssetPlugin({ noDefaultLoaders: true });
    assets.assets.registerLoader('audio', fake.loader);
    const plugin = new AudioPlugin({ context: ctx as unknown as AudioContext });
    const engine = new Engine({ scheduler: clock.scheduler, pauseOnHidden: false });
    engine.use(ecs).use(new ScenePlugin()).use(assets).use(plugin);
    engine.start();
    return { clock, ctx, fake, world: ecs.world, audio: plugin.audio, assets: assets.assets, engine };
  }

  test('playing 控制播放、播完自動設回 false、play.sound 重播、跟隨位置', async () => {
    const { clock, ctx, fake, world } = setup();
    const e = world.spawn(Transform, AudioSource.with({ url: 'fire.ogg', volume: 0.5 }));
    world.get(e, Transform)!.position.set(3, 0, 0);
    const src = world.get(e, AudioSource)!;
    clock.frame(16);
    expect(src.status).toBe('idle');

    src.playing = true;
    clock.frame(16);
    expect(src.status).toBe('loading');
    await tick();
    fake.resolve('fire.ogg');
    await tick();
    clock.frame(16);
    expect(src.status).toBe('playing');
    const panner = [...([...ctx.last.outputs][0] as FakeGain).outputs][0] as FakePanner;
    expect(panner.positionX.value).toBe(3);

    world.get(e, Transform)!.position.set(-2, 0, 0);
    clock.frame(16);
    expect(panner.positionX.value).toBe(-2);

    ctx.last.end(); // 播完
    clock.frame(16);
    expect([src.playing, src.status]).toEqual([false, 'idle']);

    play.sound(src);
    clock.frame(16);
    const first = ctx.last;
    play.sound(src); // 播放中再呼叫：從頭重播
    clock.frame(16);
    expect(first.stopAt).toBe(0);
    expect(ctx.last).not.toBe(first);
    expect(ctx.sources).toHaveLength(3);
  });

  test('循環播放、改音量、停止時淡出、移除元件會停止', async () => {
    const { clock, ctx, fake, world } = setup();
    const e = world.spawn(
      Transform,
      AudioSource.with({ url: 'loop.ogg', loop: true, playing: true, fadeOut: 1, spatial: false }),
    );
    clock.frame(16);
    await tick();
    fake.resolve('loop.ogg');
    await tick();
    clock.frame(16);
    const src = world.get(e, AudioSource)!;
    const node = ctx.last;
    expect(node.loop).toBe(true);
    src.volume = 0.2;
    clock.frame(16);
    const gain = [...node.outputs][0] as FakeGain;
    expect(gain.gain.value).toBe(0.2);

    src.playing = false;
    clock.frame(16);
    expect(node.stopAt).toBeCloseTo(ctx.currentTime + 1);

    src.playing = true;
    clock.frame(16);
    const second = ctx.last;
    world.remove(e, AudioSource);
    expect(second.stopAt).not.toBeNull();
  });

  test('載入失敗不會每幀重試', async () => {
    const { clock, fake, world } = setup();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = world.spawn(AudioSource.with({ url: 'bad.ogg', playing: true, spatial: false }));
    clock.frame(16);
    await tick();
    fake.reject('bad.ogg');
    await tick();
    clock.frame(16);
    clock.frame(16);
    errorSpy.mockRestore();
    const src = world.get(e, AudioSource)!;
    expect([src.status, src.playing, fake.calls]).toEqual(['error', false, 1]);
  });

  test('聽者：有 AudioListener 時跟隨它', () => {
    const { clock, ctx, world } = setup();
    const ear = world.spawn(Transform, AudioListener);
    const t = world.get(ear, Transform)!;
    t.position.set(0, 1, 4);
    math.lookAt(t, new THREE.Vector3(0, 1, 0));
    clock.frame(16);
    expect([ctx.listener.positionY.value, ctx.listener.positionZ.value]).toEqual([1, 4]);
    expect(ctx.listener.forwardZ.value).toBeCloseTo(-1);
  });

  test('引擎暫停時暫停聲音，恢復時繼續；卸載時停止全部並釋放', async () => {
    const { ctx, engine, audio, assets, fake } = setup();
    const loading = audio.preload(['x.ogg']);
    await tick();
    fake.resolve('x.ogg');
    await loading;
    expect(assets.refCount('x.ogg', 'audio')).toBe(1);
    await audio.unlock();
    expect(audio.unlocked).toBe(true);
    engine.pause();
    await tick();
    expect(ctx.state).toBe('suspended');
    engine.resume();
    await tick();
    expect(ctx.state).toBe('running');

    const s = audio.play(fakeBuffer());
    engine.removePlugin('audio');
    expect(s.state).toBe('stopping');
    expect(assets.refCount('x.ogg', 'audio')).toBe(0);
  });
});
