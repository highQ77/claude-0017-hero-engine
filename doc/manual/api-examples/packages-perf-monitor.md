# packages/perf-monitor 的範例

## default
效能監視器套件：FPS、每幀時間曲線、各階段 CPU、GPU 繪製次數、記憶體、實體數。按 ` 鍵顯示／隱藏，可以拖曳。

```ts
import perfMonitor from '@engine/packages/perf-monitor';

spawn.camera(world, { position: [0, 4, 8], target: [0, 0, 0] });
spawn.defaultLights(world);
for (let i = 0; i < 200; i++) spawn.mesh(world, { geometry: { box: 0.3 }, material: `hsl(${i * 7}, 70%, 60%)`, position: [Math.random() * 8 - 4, Math.random() * 3, Math.random() * 8 - 4] });
await new PluginManager(engine, { api: engineApi }).install(perfMonitor);
engine.start();
```

## PerfMonitorKey
程式控制面板的顯示：`world.getResource(PerfMonitorKey)?.toggle()`。點畫面切換。

```ts
import perfMonitor, { PerfMonitorKey } from '@engine/packages/perf-monitor';

spawn.camera(world);
await new PluginManager(engine, { api: engineApi }).install(perfMonitor, { visible: false });
addEventListener('pointerdown', () => {
  const m = world.getResource(PerfMonitorKey);
  m?.toggle();
  console.log('顯示中：', m?.visible);
});
console.log('點畫面顯示／隱藏');
engine.start();
```

## PerfStatsKey
程式讀取效能數據：`world.getResource(PerfStatsKey)`（例如自己做一個簡單的 FPS 顯示，或動態調整畫質）。

```ts
import perfMonitor, { PerfStatsKey } from '@engine/packages/perf-monitor';

spawn.camera(world, { position: [0, 2, 5], target: [0, 0, 0] });
spawn.defaultLights(world);
spawn.mesh(world, { geometry: { torusKnot: [0.7, 0.25] }, material: '#9acd32' });
await new PluginManager(engine, { api: engineApi }).install(perfMonitor, { overlay: false });
engine.timers.every(1, () => {
  const s = world.getResource(PerfStatsKey);
  if (s) console.log(`FPS ${s.fps.toFixed(0)}，每幀 ${s.frameMs.toFixed(1)} ms，繪製 ${s.gpu?.calls ?? '-'} 次，實體 ${s.entities}`);
});
engine.start();
```

## PerfMonitorOptions
安裝時的設定：按鍵、一開始顯示、更新間隔、自動加到介面、位置、可否拖曳、記住位置。

```ts
import perfMonitor, { type PerfMonitorOptions } from '@engine/packages/perf-monitor';

spawn.camera(world);
const options: PerfMonitorOptions = { interval: 0.1, position: { bottom: 12, left: 12 }, draggable: false, rememberPosition: false, toggleKey: 'KeyM' };
await new PluginManager(engine, { api: engineApi }).install(perfMonitor, options);
console.log('左下角、每 0.1 秒更新、按 M 顯示／隱藏、滑鼠會穿透');
engine.start();
```

## PerfStats
效能數據的所有欄位：FPS、每幀時間（平均、最低、最高、歷史）、各階段 CPU、記憶體、GPU、解析度、介面重畫、剛體／粒子／聲音數量。

```ts
import perfMonitor, { PerfStatsKey, type PerfStats } from '@engine/packages/perf-monitor';

spawn.camera(world);
spawn.defaultLights(world);
await new PluginManager(engine, { api: engineApi }).install(perfMonitor, { overlay: false });
engine.timers.after(1.5, () => {
  const s: PerfStats = world.getResource(PerfStatsKey)!;
  console.log('每幀', s.frameMinMs.toFixed(1), '~', s.frameMaxMs.toFixed(1), 'ms，歷史', s.history.length, '筆');
  console.log('各階段 CPU：', Object.entries(s.cpu).map(([k, v]) => `${k} ${v.toFixed(2)}`).join('、'));
  console.log('解析度：', s.resolution, '，記憶體：', s.memory?.usedMB.toFixed(0) ?? '不支援', 'MB，剛體', s.bodies);
});
engine.start();
```
