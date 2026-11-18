# @engine/audio 的範例

## AudioManager
音效管理（`audio`）：播放音效與音樂、音量群組、靜音。瀏覽器規定要在使用者操作後才能發聲，所以按按鈕播放。

```ts
import GUI from 'lil-gui';

await audio.preload(['sounds/jump.wav', 'sounds/pop.wav', 'sounds/bounce.wav']);
const gui = new GUI();
gui.add({ jump: () => audio.play('sounds/jump.wav') }, 'jump').name('跳躍');
gui.add({ pop: () => audio.play('sounds/pop.wav', { randomPitch: 0.2 }) }, 'pop').name('啵（隨機音高）');
gui.add({ bounce: () => audio.play('sounds/bounce.wav', { group: 'ui' }) }, 'bounce').name('彈跳（ui 群組）');
const volumes = { master: audio.getVolume('master'), sfx: audio.getVolume('sfx'), ui: audio.getVolume('ui') };
for (const g of ['master', 'sfx', 'ui'] as const) gui.add(volumes, g, 0, 1, 0.05).name(`${g} 音量`).onChange((v: number) => audio.setVolume(g, v));
gui.add({ mute: false }, 'mute').name('sfx 靜音').onChange((m: boolean) => audio.setMuted('sfx', m));
console.log('群組：', audio.groupNames.join('、'), '，可以發聲了嗎？', audio.unlocked);
```

## AudioPlugin
音效外掛（手冊的 `audioPlugin`）；`audioPlugin.audio` 就是 `audio`。引擎暫停時預設一起暫停聲音。

```ts
console.log('外掛：', audioPlugin.name, '，依賴：', audioPlugin.dependencies);
console.log('同一個：', audioPlugin.audio === audio, '，正在播放：', audio.activeCount);
```

## AudioSourceController
每幀更新 3D 音效的位置（外掛自動建立）。用 `AudioSource` 元件就好；這裡示範聲音繞著攝影機轉（戴耳機聽，左右聲道會變）。點畫面開始。

```ts
spawn.defaultLights(world);
const cam = spawn.camera(world, { position: [0, 1, 0], target: [0, 1, -1] });
world.remove(cam, OrbitControl);
world.add(cam, AudioListener);
const speaker = spawn.mesh(world, { geometry: { sphere: 0.3 }, material: '#ffd166' });
world.add(speaker, AudioSource, { url: 'sounds/bounce.wav', loop: true, spatial: true, refDistance: 1 });
engine.on('update', (t) => world.require(speaker, Transform).position.set(Math.cos(t.elapsed) * 3, 1, Math.sin(t.elapsed) * 3));
addEventListener('pointerdown', async () => {
  await audio.unlock();
  world.require(speaker, AudioSource).playing = true;
  console.log('播放中');
}, { once: true });
console.log('點畫面開始（戴耳機聽左右）');
engine.start();
```

## Sound
`audio.play` 回傳播放中的聲音：停止、調音量、調速度、重複。

```ts
import GUI from 'lil-gui';

let sound: Sound | null = null;
const params = { volume: 1, pitch: 1 };
const gui = new GUI();
gui.add({ start: () => {
  sound?.stop();
  sound = audio.play('sounds/bounce.wav', { loop: true, volume: params.volume, pitch: params.pitch });
  sound.ended.then(() => console.log('停了，狀態：', sound?.state));
} }, 'start').name('播放（重複）');
gui.add(params, 'volume', 0, 1, 0.05).name('音量').onChange((v: number) => sound?.setVolume(v, 0.2));
gui.add(params, 'pitch', 0.5, 2, 0.05).name('速度／音高').onChange((v: number) => sound?.setPitch(v));
gui.add({ stop: () => sound?.stop(0.5) }, 'stop').name('淡出停止');
```

## AUDIO_PRIORITY
同步聲音位置在 render 階段的順序（變換計算之後、繪製之前）。

```ts
console.log('聲音位置同步：', AUDIO_PRIORITY, '，繪製：', RENDER_DRAW_PRIORITY);
```

## AudioKey
系統裡用 `world.requireResource(AudioKey)` 取得音效管理。

```ts
console.log('和 audio 同一個：', world.requireResource(AudioKey) === audio);
```

## AudioListener
聽者：3D 音效以這個實體的位置和朝向來聽（通常加在攝影機或玩家身上）。

```ts
const camera = spawn.camera(world, { position: [0, 2, 5] });
world.add(camera, AudioListener);
console.log('聽者在攝影機上：', world.has(camera, AudioListener));
```

## AudioSource
3D 音效元件：聲音跟著實體，離聽者越遠越小聲。點方塊播放（越遠的越小聲）。

```ts
spawn.defaultLights(world);
const cam = spawn.camera(world, { position: [0, 2, 4], target: [0, 0, -3] });
world.add(cam, AudioListener);
for (let i = 0; i < 4; i++) {
  const e = spawn.mesh(world, { geometry: { box: 0.6 }, material: '#9acd32', position: [0, 0, -i * 3] });
  world.add(e, AudioSource, { url: 'sounds/pop.wav', spatial: true, refDistance: 2, rolloff: 1.5 });
}
render.renderer.domElement.addEventListener('pointerdown', (ev) => {
  const r = render.renderer.domElement.getBoundingClientRect();
  const hit = render.pick(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  if (hit && world.has(hit.entity, AudioSource)) play.sound(world.require(hit.entity, AudioSource));
});
console.log('點方塊播放');
engine.start();
```

## audioSourceCodec
AudioSource 在場景檔裡的寫法。

```ts
console.log(audioSourceCodec.write({ ...AudioSource.create(), url: 'sounds/fire.mp3', loop: true, playing: true }));
```

## play
`play.sound`：播放 AudioSource 元件的聲音（從頭播）。

```ts
const e = world.spawn(Transform, AudioSource.with({ url: 'sounds/jump.wav' }));
const source = world.require(e, AudioSource);
addEventListener('pointerdown', () => {
  play.sound(source);
  console.log('播放，token =', source.token);
});
console.log('點畫面播放');
engine.start();
```

## AudioManagerOptions
`new AudioManager(assets, options)` 的設定：音量群組、同時發聲上限。

```ts
const options: AudioManagerOptions = { groups: ['music', 'sfx', 'footsteps'], maxVoices: 8 };
const mine = new AudioManager(null, options);
console.log('群組：', mine.groupNames);
mine.dispose();
```

## AudioPluginOptions
`new AudioPlugin(options)` 的設定：AudioManager 的設定，加上引擎暫停時要不要一起暫停。

```ts
const options: AudioPluginOptions = { pauseWithEngine: false, maxVoices: 32 };
console.log('設定：', options);
```

## AudioSourceData
AudioSource 的資料：網址、群組、音量、速度、重複、播放中、3D 距離設定、狀態。

```ts
const e = world.spawn(Transform, AudioSource.with({ url: 'sounds/bounce.wav' }));
const s: AudioSourceData = world.require(e, AudioSource);
console.log('預設：volume', s.volume, '，pitch', s.pitch, '，spatial', s.spatial, '，refDistance', s.refDistance);
engine.start();
engine.timers.after(0.2, () => console.log('狀態：', s.status));
```

## MusicOptions
背景音樂的設定：淡入淡出、音量、重複。換曲時會交叉淡化。

```ts
import GUI from 'lil-gui';

const options: MusicOptions = { fade: 1.5, volume: 0.6, loop: true };
const gui = new GUI();
gui.add({ a: () => audio.playMusic('sounds/bounce.wav', options) }, 'a').name('音樂 A');
gui.add({ b: () => audio.playMusic('sounds/pop.wav', options) }, 'b').name('音樂 B（交叉淡化）');
gui.add({ stop: () => audio.stopMusic(1) }, 'stop').name('停止');
engine.timers.every(1, () => audio.currentMusic && console.log('目前的音樂：', audio.currentMusic));
engine.start();
```

## SoundOptions
播放音效的設定：群組、音量、速度、隨機音高、重複、淡入、起始秒數、3D 位置。

```ts
const options: SoundOptions = { group: 'sfx', volume: 0.8, randomPitch: 0.15, fadeIn: 0.05 };
addEventListener('pointerdown', () => {
  const s = audio.play('sounds/pop.wav', options);
  console.log('播放，狀態', s.state);
});
console.log('連續點畫面：每次音高都有點不一樣');
```

## SpatialOptions
3D 音效的距離設定：多近是原音量、多遠就不再變小、變小的速度、衰減方式。

```ts
const spatial: SpatialOptions = { refDistance: 1, maxDistance: 20, rolloff: 2, distanceModel: 'inverse' };
addEventListener('pointerdown', () => {
  const x = Math.random() * 20 - 10;
  audio.play('sounds/jump.wav', { spatial, position: { x, y: 0, z: 0 } });
  console.log('在 x =', x.toFixed(1), '播放（戴耳機聽左右）');
});
audio.setListenerMatrix(new Matrix4()); // 聽者在原點、面向 -Z
console.log('點畫面在隨機位置播放');
```

## SoundState
聲音的狀態：載入中、播放中、淡出中、已停止、播完、錯誤。

```ts
const s = audio.play('sounds/jump.wav', { volume: 0.5 });
const seen: SoundState[] = [s.state];
s.stop(0.2);
seen.push(s.state);
await s.ended;
seen.push(s.state);
console.log(seen.join(' → '));
```
